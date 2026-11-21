"""An album's covers: the front covers of its releases a site has, and which an AI model picks.

Finding is a Job in MusicBrainz's lane: it searches the album's releases and asks the
Cover Art Archive for each one's front cover, and what it finds is kept, best first,
each cover kept as an enricher's is. Asking again replaces it. Then, asked for it, an AI
model is shown the releases and a few of the album's songs and picks the one the
household most likely has, in the AI's lane; its pick stands while those are the
releases found. Nothing changes the album's cover until the household chooses one.

An album is known here by its name and artist as written, folded, so every song that
writes them alike shares what was found.
"""

import hashlib
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timedelta
from functools import partial
from pathlib import Path
from typing import Final

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application import Clock
from medleyplay.application.ai import is_set_up, provider_named
from medleyplay.application.artist_pictures import every_name_of
from medleyplay.application.jobs import JobKind, JobService, Lane
from medleyplay.application.plugins import PluginService
from medleyplay.application.scan_covers import NotACoverError, keep_copy
from medleyplay.domain.accounts import Account
from medleyplay.domain.album_covers import FoundRelease, suggested_cover
from medleyplay.domain.enrichers import AI_DETAILS, MUSICBRAINZ
from medleyplay.domain.errors import ConflictError, InvalidInputError
from medleyplay.domain.jobs import Job, JobState, failure_shown_to
from medleyplay.persistence.schema import (
    AlbumCoverDismissalRow,
    AlbumCoverSearchRow,
    LibraryArtistRow,
    TrackArtistRow,
    TrackRow,
)
from medleyplay.plugin_api import (
    COVER_CHOOSER,
    COVER_FINDER,
    MAX_ARTIST_IDS,
    MAX_NAME,
    MAX_SONGS_SHOWN,
    CoverOption,
)
from medleyplay.programs.find_covers import (
    ChooseCoverJob,
    ChosenCoverResult,
    FindCoversJob,
    FoundCoversResult,
)

FIND_COVERS_KIND: Final = "find_covers"
FINDER: Final = MUSICBRAINZ.name
"""The finder asked: the MusicBrainz plugin, in the lane its enricher keeps to."""
CHOOSE_COVER_KIND: Final = "choose_cover"
CHOOSER: Final = AI_DETAILS.name
"""The chooser asked: the AI plugin, in the lane its enricher keeps to."""
SEARCHED_IN_VAIN: Final = timedelta(days=30)
"""How long an album searched in vain waits before it is searched on its own again."""
CHOICE_TARGET: Final = "album-cover-choice:"
"""What the target of a Job that asks which release fits begins with, before the album's key."""

type FindCoversKind = JobKind[FindCoversJob, FoundCoversResult]
type ChooseCoverKind = JobKind[ChooseCoverJob, ChosenCoverResult]


_KATAKANA: Final = str.maketrans({code: code - 0x60 for code in range(ord("ァ"), ord("ヶ") + 1)})


def album_key(album: str, artist: str) -> str:
    """Return the key of the album `album` by `artist`: a hash of both, trimmed and folded.

    They fold as the page groups albums, so one album is one key everywhere: NFKC, lower
    case, and katakana as hiragana.
    """
    folded = f"{_as_grouped(artist)}\n{_as_grouped(album)}"
    return hashlib.sha256(folded.encode()).hexdigest()


def _as_grouped(text: str) -> str:
    return unicodedata.normalize("NFKC", text).lower().translate(_KATAKANA).strip()


def find_covers_target(album: str, artist: str, finder: str = FINDER) -> str:
    """Return the target of the Job that has `finder` find the album's covers."""
    return f"album-covers:{finder}:{album_key(album, artist)}"


def choose_cover_target(album: str, artist: str) -> str:
    """Return the target of the Job that asks an AI model which of the album's releases fits."""
    return f"{CHOICE_TARGET}{album_key(album, artist)}"


def find_covers_kind(clock: Clock, covers_folder: Path) -> FindCoversKind:
    """Return the kind of Job that finds an album's covers, sharing MusicBrainz's pace.

    The covers it finds are kept in `covers_folder`, as an enricher's are.
    """
    return JobKind(
        name=FIND_COVERS_KIND,
        program="medleyplay.programs.find_covers:FIND_COVERS_PROGRAM",
        request=FindCoversJob,
        result=FoundCoversResult,
        complete=partial(_complete_find, clock=clock, covers_folder=covers_folder),
        points=(COVER_FINDER.name,),
        needs_network=True,
        lane_field="finder",
        lanes={FINDER: Lane(spacing=MUSICBRAINZ.spacing, shared=MUSICBRAINZ.name)},
    )


def choose_cover_kind(clock: Clock) -> ChooseCoverKind:
    """Return the kind of Job that asks an AI model which of an album's releases fits it."""
    return JobKind(
        name=CHOOSE_COVER_KIND,
        program="medleyplay.programs.find_covers:CHOOSE_COVER_PROGRAM",
        request=ChooseCoverJob,
        result=ChosenCoverResult,
        complete=partial(_complete_choice, clock=clock),
        points=(COVER_CHOOSER.name,),
        needs_network=True,
        lane_field="chooser",
        lanes={CHOOSER: Lane(spacing=AI_DETAILS.spacing, lends_ai=True, shared=AI_DETAILS.name)},
    )


@dataclass(frozen=True)
class AlbumCoverKinds:
    """The kinds of Job the album cover service submits: finding covers, and choosing one."""

    find: FindCoversKind
    choose: ChooseCoverKind


def album_cover_kinds(clock: Clock, covers_folder: Path) -> AlbumCoverKinds:
    """Return the kinds of Job the service submits, keeping covers in `covers_folder`."""
    return AlbumCoverKinds(find_covers_kind(clock, covers_folder), choose_cover_kind(clock))


@dataclass(frozen=True)
class FoundAlbumCover:
    """A release of the album, and the cover holding its front cover."""

    option: CoverOption
    cover: str


@dataclass(frozen=True)
class CoverPick:
    """The release an AI model picked of those found, why, and the model that answered."""

    release_id: str
    why: str
    model: str
    host: str
    at: datetime


@dataclass(frozen=True)
class AlbumCovers:
    """What is known of an album's covers, and what is being asked.

    `covers` are those last found, best first, at `found_at`; `pick` is an AI model's
    pick among them, while they are the releases it was shown. `finding` and `choosing`
    say whether a site or a model is asked now, and `waiting` that the asking waits for
    medleyplay to be Online, or to try again. `failure` and `choice_failure` say why the
    last asking failed, to the Account that asked and to admins. `may_choose` says an AI
    model may be asked: one is set up, the covers are found, and none picked among them.
    `suggested` is the cover suggested as the album's, if any, and `due` says the album
    may be searched on its own: never searched, or searched in vain over 30 days ago.
    `may_find` says MusicBrainz is on to be asked.
    """

    covers: tuple[FoundAlbumCover, ...]
    found_at: datetime | None
    pick: CoverPick | None
    finding: bool
    choosing: bool
    waiting: bool
    failure: str | None
    choice_failure: str | None
    may_choose: bool
    suggested: str | None = None
    due: bool = False
    may_find: bool = False


class AlbumCoverService:
    """Finds the covers of an album's releases, and asks an AI model which fits it."""

    def __init__(
        self,
        units: sessionmaker[Session],
        plugins: PluginService,
        jobs: JobService,
        kinds: AlbumCoverKinds,
        clock: Clock,
    ) -> None:
        """Create the service, submitting Jobs of `kinds` to `jobs`."""
        self._units = units
        self._plugins = plugins
        self._jobs = jobs
        self._kinds = kinds
        self._clock = clock

    def find(self, caller: Account, album: str, artist: str) -> None:
        """Ask MusicBrainz for the covers of the album's releases; asking again while asked waits.

        `artist` is the album artist, else the artist; empty for none.
        """
        album, artist = checked_album(album, artist)
        if FINDER not in self._plugins.available_keys().get(COVER_FINDER.name, []):
            message = "Turn on the MusicBrainz plugin to find covers."
            raise ConflictError(message)
        with self._units() as db:
            linked = linked_artists_of(db, album, artist)
        request = FindCoversJob(album=album, artist=artist, artist_ids=linked, finder=FINDER)
        self._jobs.submit(self._kinds.find, find_covers_target(album, artist), request, caller.id)

    def choose(self, caller: Account, album: str, artist: str) -> None:
        """Ask an AI model which of the releases found is the album; asking twice waits.

        Asking while one has picked among the covers found asks nothing.
        """
        album, artist = checked_album(album, artist)
        if CHOOSER not in self._plugins.available_keys().get(COVER_CHOOSER.name, []):
            message = "Turn on the ai-details plugin to ask an AI model."
            raise ConflictError(message)
        with self._units() as db:
            if not is_set_up(db):
                message = "Set up an AI provider in Settings to ask it."
                raise ConflictError(message)
            row = db.get(AlbumCoverSearchRow, (album_key(album, artist), FINDER))
            found = () if row is None else _covers_of(row)
            if not found:
                message = "Find the album's covers before asking which fits it."
                raise ConflictError(message)
            if row is not None and row.chosen_at is not None and _picked_among(row, found):
                return
            songs = songs_of(db, album, artist)
        request = ChooseCoverJob(
            album=album,
            artist=artist,
            songs=songs,
            options=tuple(each.option for each in found),
            chooser=CHOOSER,
        )
        self._jobs.submit(
            self._kinds.choose, choose_cover_target(album, artist), request, caller.id
        )

    def covers(self, viewer: Account, album: str, artist: str) -> AlbumCovers:
        """Return what is known of the album's covers, and what is being asked."""
        album, artist = checked_album(album, artist)
        with self._units() as db:
            key = album_key(album, artist)
            row = db.get(AlbumCoverSearchRow, (key, FINDER))
            found = () if row is None else _covers_of(row)
            pick = None if row is None else _pick_of(row, found)
            ai = is_set_up(db)
            suggested = suggested_cover(
                album,
                _names_of(db, album, artist),
                [FoundRelease(each.option.title, each.option.artist, each.cover) for each in found],
                _cover_picked(pick, found),
                _dismissed(db, key),
            )
        finding = self._jobs.latest(FIND_COVERS_KIND, find_covers_target(album, artist))
        choosing = self._jobs.latest(CHOOSE_COVER_KIND, choose_cover_target(album, artist))
        asking = [job for job in (finding, choosing) if job is not None and job.state.is_active]
        chosen = row is not None and row.chosen_at is not None and _picked_among(row, found)
        choice_failed = choosing is not None and choosing.state is JobState.FAILED
        return AlbumCovers(
            covers=found,
            found_at=None if row is None else row.found_at,
            pick=pick,
            finding=finding is not None and finding.state.is_active,
            choosing=choosing is not None and choosing.state.is_active,
            # Asking needs the network, so it waits while medleyplay is Offline.
            waiting=any(job.state is JobState.WAITING or not self._jobs.online() for job in asking),
            failure=_failure(finding, viewer),
            choice_failure=_failure(choosing, viewer),
            may_choose=ai
            and bool(found)
            and not chosen
            and not choice_failed
            and CHOOSER in self._plugins.available_keys().get(COVER_CHOOSER.name, []),
            suggested=suggested,
            due=row is None or (not found and self._clock() - row.found_at > SEARCHED_IN_VAIN),
            may_find=FINDER in self._plugins.available_keys().get(COVER_FINDER.name, []),
        )

    def dismiss(self, caller: Account, album: str, artist: str, cover: str) -> None:
        """Suggest the cover found for the album no more, even once found again."""
        del caller
        album, artist = checked_album(album, artist)
        key = album_key(album, artist)
        with self._units.begin() as db:
            row = db.get(AlbumCoverSearchRow, (key, FINDER))
            if row is None or all(each.cover != cover for each in _covers_of(row)):
                message = "Only a cover found for the album may be dismissed."
                raise InvalidInputError(message)
            if db.get(AlbumCoverDismissalRow, (key, cover)) is None:
                db.add(AlbumCoverDismissalRow(key=key, cover=cover))


def checked_album(album: str, artist: str) -> tuple[str, str]:
    """Return the album and its artist trimmed, refusing an album unnamed or a name too long."""
    album, artist = album.strip(), artist.strip()
    if not album:
        message = "Name the album to find its covers."
        raise InvalidInputError(message)
    if len(album) > MAX_NAME or len(artist) > MAX_NAME:
        message = f"An album and its artist are each at most {MAX_NAME} characters."
        raise InvalidInputError(message)
    return album, artist


def _failure(job: Job | None, viewer: Account) -> str | None:
    if job is None or job.state is not JobState.FAILED:
        return None
    return failure_shown_to(job, viewer) or None


def _covers_of(row: AlbumCoverSearchRow) -> tuple[FoundAlbumCover, ...]:
    return tuple(
        FoundAlbumCover(option=CoverOption.model_validate(each["option"]), cover=str(each["cover"]))
        for each in row.covers
    )


def _cover_picked(pick: CoverPick | None, found: tuple[FoundAlbumCover, ...]) -> str | None:
    if pick is None:
        return None
    return next((each.cover for each in found if each.option.release_id == pick.release_id), None)


def _dismissed(db: Session, key: str) -> set[str]:
    dismissed = select(AlbumCoverDismissalRow.cover).where(AlbumCoverDismissalRow.key == key)
    return set(db.scalars(dismissed))


def _names_of(db: Session, album: str, artist: str) -> list[str]:
    """Return every name the album's artist goes by: as written, and its linked artists' names."""
    names = [artist]
    for artist_id in linked_artists_of(db, album, artist):
        names.extend(every_name_of(db, artist_id))
    return names


def _picked_among(row: AlbumCoverSearchRow, found: tuple[FoundAlbumCover, ...]) -> bool:
    """Return whether the model that last picked was shown the releases found now."""
    return list(row.offered) == [each.option.release_id for each in found]


def _pick_of(row: AlbumCoverSearchRow, found: tuple[FoundAlbumCover, ...]) -> CoverPick | None:
    if row.pick is None or row.chosen_at is None or not _picked_among(row, found):
        return None
    return CoverPick(
        release_id=row.pick, why=row.why, model=row.model, host=row.host, at=row.chosen_at
    )


def track_ids_of(db: Session, album: str, artist: str) -> list[int]:
    """Return the Tracks of the album, as the Library writes it."""
    key = album_key(album, artist)
    rows = db.execute(
        select(TrackRow.id, TrackRow.album, TrackRow.album_artist, TrackRow.artist).where(
            TrackRow.album != ""
        )
    )
    return [
        track_id
        for track_id, written, album_artist, track_artist in rows
        if album_key(written, album_artist or track_artist) == key
    ]


def linked_artists_of(db: Session, album: str, artist: str) -> tuple[str, ...]:
    """Return the MusicBrainz artists the album's songs are linked to, a few at most.

    Those its album artists name come first; without any, those its songs' main artists name.
    """
    track_ids = track_ids_of(db, album, artist)
    rows = db.execute(
        select(TrackArtistRow.album_artist, LibraryArtistRow.musicbrainz_id)
        .join(LibraryArtistRow, LibraryArtistRow.id == TrackArtistRow.artist_id)
        .where(
            TrackArtistRow.track_id.in_(track_ids),
            TrackArtistRow.role == "main",
            LibraryArtistRow.musicbrainz_id.is_not(None),
        )
        .order_by(TrackArtistRow.track_id, TrackArtistRow.position)
    ).all()
    of_album = [mbid for album_artist, mbid in rows if album_artist and mbid]
    chosen = of_album or [mbid for album_artist, mbid in rows if not album_artist and mbid]
    return tuple(dict.fromkeys(chosen))[:MAX_ARTIST_IDS]


def songs_of(db: Session, album: str, artist: str) -> tuple[str, ...]:
    """Return a few titles of the songs of the album, as the Library writes it."""
    key = album_key(album, artist)
    rows = db.execute(
        select(TrackRow.title, TrackRow.album, TrackRow.album_artist, TrackRow.artist)
        .where(TrackRow.album != "")
        .order_by(TrackRow.id)
    )
    songs: list[str] = []
    for title, written, album_artist, track_artist in rows:
        if album_key(written, album_artist or track_artist) == key and title:
            songs.append(title[:MAX_NAME])
        if len(songs) == MAX_SONGS_SHOWN:
            break
    return tuple(songs)


def _complete_find(
    db: Session, job: Job, result: FoundCoversResult, *, clock: Clock, covers_folder: Path
) -> None:
    """Keep the covers found for the album, replacing those found before, and any pick."""
    del job
    covers: list[dict[str, object]] = []
    for found in result.covers:
        try:
            cover = keep_copy(found.cover, covers_folder)
        except NotACoverError:
            continue
        covers.append({"option": found.option.model_dump(mode="json"), "cover": cover})
    key = album_key(result.album, result.artist)
    row = db.get(AlbumCoverSearchRow, (key, FINDER)) or AlbumCoverSearchRow(key=key, finder=FINDER)
    row.album, row.artist, row.covers, row.found_at = result.album, result.artist, covers, clock()
    row.offered, row.pick, row.why, row.model, row.host, row.chosen_at = [], None, "", "", "", None
    db.add(row)


def _complete_choice(db: Session, job: Job, result: ChosenCoverResult, *, clock: Clock) -> None:
    """Keep the release the model picked, with the model that answered.

    A pick among releases other than those found now, as covers found again since, is
    dropped.
    """
    row = db.get(AlbumCoverSearchRow, (job.target.removeprefix(CHOICE_TARGET), FINDER))
    if row is None or list(result.offered) != [each.option.release_id for each in _covers_of(row)]:
        return
    named = provider_named(db, result.ai_answered or None)
    model, host = named if named is not None else ("an AI model", "")
    row.offered, row.pick, row.why = list(result.offered), result.release_id, result.why
    row.model, row.host, row.chosen_at = model, host, clock()
