"""One artist under many names: looking the Library's names up, and the links the household chose.

Every artist and album artist name Tracks show is listed once, by its folded form,
with how many Tracks show it. A name may be looked up on MusicBrainz, a Job per
name in MusicBrainz's lane, and what it knows is kept: the artists, best first, and
every name each goes by. The household then links the name to one of them, or to
none; the one going by the name exactly is suggested. Names linked to one artist
count as one artist wherever the Library groups by artist, while every Track keeps
the name as written.

Once a name is linked, Wikidata is asked every name the artist goes by, a Job per
artist in its own lane, for the names MusicBrainz lacks, such as *甲壳虫* for The
Beatles. A name that an artist already linked goes by is offered that artist, with
nothing asked of any site.
"""

from collections import Counter
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import datetime, timedelta
from functools import partial
from typing import Final

from sqlalchemy import delete, select
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application import Clock
from medleyplay.application.jobs import JobKind, JobService, Lane
from medleyplay.application.plugins import PluginService
from medleyplay.domain.accounts import Account
from medleyplay.domain.artists import (
    Alias,
    Artist,
    Candidate,
    LookUp,
    artist_key,
    may_look_up,
    queries_for,
    suggested,
)
from medleyplay.domain.enrichers import MUSICBRAINZ
from medleyplay.domain.errors import ConflictError, InvalidInputError, NotFoundError
from medleyplay.domain.jobs import Job
from medleyplay.persistence.schema import (
    ArtistAliasRow,
    ArtistLinkRow,
    ArtistRow,
    ArtistSearchRow,
    TrackRow,
)
from medleyplay.plugin_api import ARTIST_FINDER, ARTIST_NAME_FINDER
from medleyplay.programs.find_artist import (
    FindArtistJob,
    FindArtistNamesJob,
    FoundArtistNamesResult,
    FoundArtistsResult,
)

FIND_ARTIST_KIND: Final = "find_artist"
FINDER: Final = MUSICBRAINZ.name
"""The finder asked: the MusicBrainz plugin, in the lane its enricher keeps to."""
MAX_LOOK_UP: Final = 500
"""The most names looked up at once."""
FIND_ARTIST_NAMES_KIND: Final = "find_artist_names"
NAME_FINDER: Final = "wikipedia"
"""The name finder asked: the plugin that reads Wikidata."""
NAME_FINDER_SPACING: Final = timedelta(seconds=1)
"""The least time between two artists' Jobs; the plugin spaces its own two requests."""
KNOWN_SCORE: Final = 100
"""The score of an artist offered because an artist already linked goes by the name."""

type FindArtistKind = JobKind[FindArtistJob, FoundArtistsResult]
type FindArtistNamesKind = JobKind[FindArtistNamesJob, FoundArtistNamesResult]


def find_artist_kind(clock: Clock) -> FindArtistKind:
    """Return the kind of Job that looks a name up, sharing MusicBrainz's pace."""
    return JobKind(
        name=FIND_ARTIST_KIND,
        program="medleyplay.programs.find_artist:FIND_ARTIST_PROGRAM",
        request=FindArtistJob,
        result=FoundArtistsResult,
        complete=partial(_complete, clock=clock),
        points=(ARTIST_FINDER.name,),
        needs_network=True,
        lane_field="finder",
        lanes={FINDER: Lane(spacing=MUSICBRAINZ.spacing, shared=MUSICBRAINZ.name)},
    )


def find_artist_names_kind(clock: Clock) -> FindArtistNamesKind:
    """Return the kind of Job that asks Wikidata every name an artist goes by."""
    return JobKind(
        name=FIND_ARTIST_NAMES_KIND,
        program="medleyplay.programs.find_artist:FIND_ARTIST_NAMES_PROGRAM",
        request=FindArtistNamesJob,
        result=FoundArtistNamesResult,
        complete=partial(_complete_names, clock=clock),
        points=(ARTIST_NAME_FINDER.name,),
        needs_network=True,
        lane_field="finder",
        lanes={NAME_FINDER: Lane(spacing=NAME_FINDER_SPACING, shared=NAME_FINDER)},
    )


def find_artist_target(name: str) -> str:
    """Return the target of the Job that looks `name` up."""
    return f"artist:{artist_key(name)}"


@dataclass(frozen=True)
class KnownArtist:
    """An artist MusicBrainz knows, with every name it goes by."""

    artist: Artist
    aliases: tuple[Alias, ...]


@dataclass(frozen=True)
class ArtistName:
    """A name the Library's Tracks show as an artist or album artist, and what is known of it.

    `linked` says whether the household chose for it; then `artist_id` is the artist it
    chose, or `None` for none. `candidates` are what MusicBrainz last answered, at
    `looked_at`, and, for a name not linked, the artists already linked that go by
    it, scored 100; best first, as ids and scores. `suggested` is the one to offer.
    """

    name: str
    key: str
    tracks: int
    look_up: LookUp
    linked: bool
    artist_id: str | None
    looked_at: datetime | None
    candidates: tuple[tuple[str, int], ...]
    suggested: str | None
    finding: bool


@dataclass(frozen=True)
class ArtistNames:
    """Every artist name the Library shows, most Tracks first, and the artists they name."""

    names: tuple[ArtistName, ...]
    artists: dict[str, KnownArtist]


class ArtistService:
    """List the Library's artist names, look them up, and keep the links the household chose."""

    def __init__(
        self,
        units: sessionmaker[Session],
        clock: Clock,
        plugins: PluginService,
        jobs: JobService,
        kind: FindArtistKind,
        names_kind: FindArtistNamesKind,
        on_change: Callable[[str], None] | None = None,
    ) -> None:
        """Create a service over the database `units` open, telling `on_change` of each change."""
        self._units = units
        self._clock = clock
        self._plugins = plugins
        self._jobs = jobs
        self._kind = kind
        self._names_kind = names_kind
        self._on_change = on_change

    def names(self) -> ArtistNames:
        """Return every artist and album artist name Tracks show, and what is known of each."""
        with self._units() as db:
            shown = db.execute(select(TrackRow.id, TrackRow.artist, TrackRow.album_artist)).all()
            links = {row.key: row for row in db.scalars(select(ArtistLinkRow))}
            searches = {row.key: row for row in db.scalars(select(ArtistSearchRow))}
            artists = _known(db)
        known_by = _known_by(artists, {row.artist_id for row in links.values()})
        written: dict[str, Counter[str]] = {}
        tracks: dict[str, set[int]] = {}
        for track_id, artist, album_artist in shown:
            for name in {artist, album_artist}:
                if name and name.strip():
                    key = artist_key(name)
                    written.setdefault(key, Counter())[name.strip()] += 1
                    tracks.setdefault(key, set()).add(track_id)
        found = [
            self._name_of(
                key,
                forms.most_common(1)[0][0],
                len(tracks[key]),
                links,
                searches,
                artists,
                known_by,
            )
            for key, forms in written.items()
        ]
        found.sort(key=lambda each: (-each.tracks, each.key))
        return ArtistNames(tuple(found), artists)

    def look_up(self, caller: Account, names: Iterable[str]) -> int:
        """Ask MusicBrainz about each name not yet linked; return how many are being asked.

        A name naming no one artist, or with more than the name in it, isn't asked.
        Every artist linked whose names Wikidata hasn't answered yet is asked about too,
        such as one linked while the `wikipedia` plugin was off.
        """
        if FINDER not in self._plugins.available_keys().get(ARTIST_FINDER.name, []):
            message = "Turn on the MusicBrainz plugin to find artists."
            raise ConflictError(message)
        wanted = list(dict.fromkeys(name.strip() for name in names))
        if len(wanted) > MAX_LOOK_UP:
            message = f"Look up at most {MAX_LOOK_UP} names at once."
            raise InvalidInputError(message)
        with self._units() as db:
            linked = set(db.scalars(select(ArtistLinkRow.key)))
        asked = 0
        for name in wanted:
            if may_look_up(name) is not LookUp.YES or artist_key(name) in linked:
                continue
            request = FindArtistJob(name=name[:512], queries=queries_for(name), finder=FINDER)
            self._jobs.submit(self._kind, find_artist_target(name), request, caller.id)
            asked += 1
        with self._units() as db:
            unnamed = db.scalars(
                select(ArtistLinkRow.artist_id)
                .join(ArtistRow, ArtistRow.id == ArtistLinkRow.artist_id)
                .where(ArtistRow.names_at.is_(None))
            ).all()
        self._find_names(caller, unnamed)
        return asked

    def link(self, caller: Account, name: str, artist_id: str | None) -> None:
        """Link `name` to the artist `artist_id`, or to none, in place of any link it had.

        Wikidata is then asked every name the artist goes by, unless it answered before
        or the `wikipedia` plugin is off.
        """
        key = artist_key(name)
        if not key:
            message = "Name the artist to link."
            raise InvalidInputError(message)
        with self._units.begin() as db:
            if artist_id is not None and db.get(ArtistRow, artist_id) is None:
                message = "MusicBrainz hasn't named that artist for any name here."
                raise NotFoundError(message)
            row = db.get(ArtistLinkRow, key)
            if row is None:
                db.add(
                    ArtistLinkRow(
                        key=key, name=name.strip(), artist_id=artist_id, linked_at=self._clock()
                    )
                )
            else:
                row.name, row.artist_id, row.linked_at = name.strip(), artist_id, self._clock()
        self._changed()
        if artist_id is not None:
            with self._units() as db:
                unnamed = db.scalars(
                    select(ArtistRow.id).where(
                        ArtistRow.id == artist_id, ArtistRow.names_at.is_(None)
                    )
                ).all()
            self._find_names(caller, unnamed)

    def unlink(self, name: str) -> None:
        """Forget the link of `name`, so it is offered again."""
        with self._units.begin() as db:
            db.execute(delete(ArtistLinkRow).where(ArtistLinkRow.key == artist_key(name)))
        self._changed()

    def _find_names(self, caller: Account, artist_ids: Iterable[str | None]) -> None:
        """Ask Wikidata every name each artist goes by, while the `wikipedia` plugin is on."""
        if NAME_FINDER not in self._plugins.available_keys().get(ARTIST_NAME_FINDER.name, []):
            return
        for artist_id in dict.fromkeys(artist_ids):
            if artist_id is not None:
                request = FindArtistNamesJob(artist_id=artist_id, finder=NAME_FINDER)
                self._jobs.submit(self._names_kind, f"artist-names:{artist_id}", request, caller.id)

    def _name_of(
        self,
        key: str,
        name: str,
        tracks: int,
        links: dict[str, ArtistLinkRow],
        searches: dict[str, ArtistSearchRow],
        artists: dict[str, KnownArtist],
        known_by: dict[str, set[str]],
    ) -> ArtistName:
        link = links.get(key)
        search = searches.get(key)
        found = () if search is None else _found_of(search)
        if link is None and may_look_up(name) is LookUp.YES:
            found = _with_known(found, known_by.get(key, set()))
        candidates = [
            Candidate(artists[id_].artist, score, artists[id_].aliases)
            for id_, score in found
            if id_ in artists
        ]
        return ArtistName(
            name=name,
            key=key,
            tracks=tracks,
            look_up=may_look_up(name),
            linked=link is not None,
            artist_id=None if link is None else link.artist_id,
            looked_at=None if search is None else search.looked_at,
            candidates=found,
            suggested=suggested(name, candidates),
            finding=self._jobs.active(FIND_ARTIST_KIND, f"artist:{key}") is not None,
        )

    def _changed(self) -> None:
        if self._on_change is not None:
            self._on_change("catalog")


def _complete(db: Session, job: Job, result: FoundArtistsResult, *, clock: Clock) -> None:
    """Keep the artists MusicBrainz knows by the name, and that it was asked; a rerun agrees."""
    del job
    now = clock()
    for found in result.artists:
        row = db.get(ArtistRow, found.id)
        if row is None:
            row = ArtistRow(id=found.id, found_at=now)
            db.add(row)
        row.name, row.sort_name = found.name, found.sort_name
        row.disambiguation, row.country, row.found_at = found.disambiguation, found.country, now
        db.execute(
            delete(ArtistAliasRow).where(
                ArtistAliasRow.artist_id == found.id, ArtistAliasRow.origin == result.finder
            )
        )
        db.flush()
        db.add_all(
            ArtistAliasRow(
                artist_id=found.id,
                origin=result.finder,
                name=alias.name,
                key=artist_key(alias.name),
                locale=alias.locale,
                primary=alias.primary,
            )
            for alias in {each.name: each for each in found.aliases}.values()
        )
    key = artist_key(result.name)
    search = db.get(ArtistSearchRow, key)
    found_ids = [{"id": each.id, "score": each.score} for each in result.artists]
    if search is None:
        db.add(ArtistSearchRow(key=key, name=result.name, found=found_ids, looked_at=now))
    else:
        search.name, search.found, search.looked_at = result.name, found_ids, now


def _complete_names(db: Session, job: Job, result: FoundArtistNamesResult, *, clock: Clock) -> None:
    """Keep every name the finder knows the artist by, in place of those it gave before."""
    del job
    row = db.get(ArtistRow, result.artist_id)
    if row is None:
        return
    db.execute(
        delete(ArtistAliasRow).where(
            ArtistAliasRow.artist_id == result.artist_id, ArtistAliasRow.origin == result.finder
        )
    )
    db.flush()
    db.add_all(
        ArtistAliasRow(
            artist_id=result.artist_id,
            origin=result.finder,
            name=alias.name,
            key=artist_key(alias.name),
            locale=alias.locale,
            primary=alias.primary,
        )
        for alias in {each.name: each for each in result.aliases}.values()
    )
    row.names_at = clock()


def _with_known(found: tuple[tuple[str, int], ...], known: set[str]) -> tuple[tuple[str, int], ...]:
    """Return `found` with the artists already linked that go by the name, each once."""
    scores = dict.fromkeys(sorted(known), KNOWN_SCORE)
    for artist_id, score in found:
        scores[artist_id] = max(score, scores.get(artist_id, 0))
    return tuple(sorted(scores.items(), key=lambda each: -each[1]))


def _known_by(artists: dict[str, KnownArtist], linked: set[str | None]) -> dict[str, set[str]]:
    """Return the artists linked to some name, by the folded form of every name they go by."""
    by: dict[str, set[str]] = {}
    for artist_id in linked:
        known = None if artist_id is None else artists.get(artist_id)
        if artist_id is None or known is None:
            continue
        names = (known.artist.name, known.artist.sort_name, *(a.name for a in known.aliases))
        for name in names:
            if name.strip():
                by.setdefault(artist_key(name), set()).add(artist_id)
    return by


def _found_of(search: ArtistSearchRow) -> tuple[tuple[str, int], ...]:
    found: list[tuple[str, int]] = []
    for each in search.found:
        artist_id, score = each.get("id"), each.get("score")
        if isinstance(artist_id, str) and isinstance(score, int):
            found.append((artist_id, score))
    return tuple(found)


def _known(db: Session) -> dict[str, KnownArtist]:
    """Return every artist known, each with its names once: MusicBrainz's first."""
    aliases: dict[str, dict[str, Alias]] = {}
    rows = db.scalars(select(ArtistAliasRow).order_by(ArtistAliasRow.name)).all()
    for row in sorted(rows, key=lambda row: row.origin != FINDER):
        names = aliases.setdefault(row.artist_id, {})
        names.setdefault(row.key, Alias(row.name, row.locale, row.primary))
    return {
        row.id: KnownArtist(
            Artist(row.id, row.name, row.sort_name, row.disambiguation, row.country),
            tuple(aliases.get(row.id, {}).values()),
        )
        for row in db.scalars(select(ArtistRow))
    }
