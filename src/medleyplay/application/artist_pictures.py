"""Pictures of an artist a site has, to choose the household's photo of it from.

Finding is a Job in the site's own lane: the site is asked for pictures of the artists
going by the artist's name, the name the household shows it by, else MusicBrainz's,
and what it finds is kept, the most followed first, each picture kept as a cover is.
Asking again replaces it. A site is asked only once the household has turned it on in
Settings, and nothing changes the artist's photo until the household uses a picture.

An AI model may be asked which picture is of the artist, with a note from the listener
saying which artist they mean; its pick is kept until the pictures are found again.
Asking again among the same pictures with the same note asks nothing. The picture
suggested is the model's pick, else the one whose artist goes by one of the artist's
names, most followed first; the household may have a model asked as soon as pictures
are found.

Without anyone asking, the site is asked about the artists linked to MusicBrainz that
have no photo and were never looked up: those of the songs up next, or every one, as
the household chooses in Settings; each is a Job of the site's lane, a moment apart.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timedelta
from functools import partial
from pathlib import Path
from typing import Final

from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application import Clock
from medleyplay.application.ai import is_set_up, provider_named
from medleyplay.application.jobs import JobKind, JobService, Lane
from medleyplay.application.plugins import PluginService
from medleyplay.application.scan_covers import NotACoverError, keep_copy
from medleyplay.application.settings import read_settings
from medleyplay.domain.accounts import Account
from medleyplay.domain.artists import PictureSite, artist_key, likeliest_picture
from medleyplay.domain.enrichers import AI_DETAILS
from medleyplay.domain.errors import ConflictError, InvalidInputError, NotFoundError
from medleyplay.domain.jobs import Job, JobState, failure_shown_to
from medleyplay.domain.settings import PhotoSearch
from medleyplay.persistence.schema import (
    ArtistAliasRow,
    ArtistHouseholdRow,
    ArtistPictureSearchRow,
    ArtistRow,
    LibraryArtistRow,
    TrackArtistRow,
    TrackRow,
)
from medleyplay.plugin_api import (
    MAX_HINT,
    MAX_NAME,
    MAX_OTHER_NAMES,
    MAX_SONGS_SHOWN,
    PICTURE_CHOOSER,
    PICTURE_FINDER,
    PictureOption,
)
from medleyplay.programs.find_pictures import (
    ChoosePictureJob,
    ChosenPictureResult,
    FindPicturesJob,
    FoundPicturesResult,
)

FIND_PICTURES_KIND: Final = "find_pictures"
CHOOSE_PICTURE_KIND: Final = "choose_picture"
CHOOSER: Final = AI_DETAILS.name
SITE: Final = PictureSite.DEEZER
"""The site asked: Deezer, the only one so far."""
SPACING: Final = timedelta(seconds=2)
"""The least time between two findings; each asks the site a few times, a moment apart."""

type FindPicturesKind = JobKind[FindPicturesJob, FoundPicturesResult]
type ChoosePictureKind = JobKind[ChoosePictureJob, ChosenPictureResult]


def find_pictures_target(artist_id: str) -> str:
    """Return the target of the Job that finds pictures of the artist."""
    return f"artist-pictures:{artist_id}"


def find_pictures_kind(clock: Clock, covers_folder: Path) -> FindPicturesKind:
    """Return the kind of Job that finds pictures of an artist, kept in `covers_folder`."""
    return JobKind(
        name=FIND_PICTURES_KIND,
        program="medleyplay.programs.find_pictures:FIND_PICTURES_PROGRAM",
        request=FindPicturesJob,
        result=FoundPicturesResult,
        complete=partial(_complete_find, clock=clock, covers_folder=covers_folder),
        points=(PICTURE_FINDER.name,),
        needs_network=True,
        lane_field="finder",
        lanes={SITE.value: Lane(spacing=SPACING)},
    )


def choose_picture_target(artist_id: str) -> str:
    """Return the target of the Job that asks an AI model which picture is of the artist."""
    return f"artist-picture-choice:{artist_id}"


def choose_picture_kind(clock: Clock) -> ChoosePictureKind:
    """Return the kind of Job that asks an AI model which picture found is of an artist."""
    return JobKind(
        name=CHOOSE_PICTURE_KIND,
        program="medleyplay.programs.find_pictures:CHOOSE_PICTURE_PROGRAM",
        request=ChoosePictureJob,
        result=ChosenPictureResult,
        complete=partial(_complete_choice, clock=clock),
        points=(PICTURE_CHOOSER.name,),
        needs_network=True,
        lane_field="chooser",
        lanes={CHOOSER: Lane(spacing=AI_DETAILS.spacing, lends_ai=True, shared=AI_DETAILS.name)},
    )


@dataclass(frozen=True)
class ArtistPictureKinds:
    """The kinds of Job the picture service submits: finding pictures, and choosing one."""

    find: FindPicturesKind
    choose: ChoosePictureKind


def artist_picture_kinds(clock: Clock, covers_folder: Path) -> ArtistPictureKinds:
    """Return the kinds of Job the service submits, keeping pictures in `covers_folder`."""
    return ArtistPictureKinds(find_pictures_kind(clock, covers_folder), choose_picture_kind(clock))


@dataclass(frozen=True)
class FoundPicture:
    """A picture of an artist the site knows by `name`, `fans` following it, and its cover."""

    name: str
    fans: int | None
    cover: str


@dataclass(frozen=True)
class PicturePick:
    """The picture an AI model picked of those found, why, who answered, and the note it had."""

    cover: str
    why: str
    model: str
    host: str
    at: datetime
    hint: str


@dataclass(frozen=True)
class ArtistPictures:
    """What is known of the pictures of an artist a site has, and what is being asked.

    `pictures` are those last found, the most followed first, at `found_at`. `finding`
    says the site is asked now, and `waiting` that the asking waits for medleyplay to be
    Online, or to try again. `failure` says why the last asking failed, to the Account
    that asked and to admins. `may_find` says the household turned the site on.
    `pick` is the picture an AI model picked, `choosing` says one is asked now,
    `choice_failure` why the last asking failed, and `may_choose` that one may be asked.
    `suggested` is the cover suggested as the artist's photo, and `auto_pick` says the
    household has a model asked as soon as pictures are found.
    """

    pictures: tuple[FoundPicture, ...]
    found_at: datetime | None
    finding: bool
    waiting: bool
    failure: str | None
    may_find: bool
    pick: PicturePick | None = None
    choosing: bool = False
    choice_failure: str | None = None
    may_choose: bool = False
    suggested: str | None = None
    auto_pick: bool = False


@dataclass(frozen=True)
class MissingPhoto:
    """An artist linked to MusicBrainz with no photo, how many songs it has, and its suggestion.

    `suggested` is the cover suggested as its photo, `picked` whether an AI model picked
    it, `found` whether the site was asked about it, and `finding` whether it is now.
    """

    artist_id: str
    name: str
    songs: int
    suggested: str | None
    picked: bool
    found: bool
    finding: bool


MAX_FIND_TRACKS: Final = 50
"""The most songs whose artists are asked about at once."""


class ArtistPictureService:
    """Finds pictures of an artist on the site the household turned on."""

    def __init__(
        self,
        units: sessionmaker[Session],
        plugins: PluginService,
        jobs: JobService,
        kinds: ArtistPictureKinds,
    ) -> None:
        """Create the service, submitting Jobs of `kinds` to `jobs`."""
        self._units = units
        self._plugins = plugins
        self._jobs = jobs
        self._kinds = kinds

    def find(self, caller: Account, artist_id: str) -> None:
        """Ask the site for pictures of the artist; asking again while asked waits."""
        with self._units() as db:
            name = _name_of(db, artist_id)
            turned_on = SITE in read_settings(db).picture_sites
        if not turned_on:
            message = "Turn on Deezer in Settings to find pictures of an artist."
            raise ConflictError(message)
        if SITE.value not in self._plugins.available_keys().get(PICTURE_FINDER.name, []):
            message = "Turn on the deezer plugin to find pictures of an artist."
            raise ConflictError(message)
        request = FindPicturesJob(artist_id=artist_id, name=name, finder=SITE.value)
        self._jobs.submit(self._kinds.find, find_pictures_target(artist_id), request, caller.id)

    def choose(self, caller: Account, artist_id: str, hint: str = "") -> None:
        """Ask an AI model which picture found is of the artist, with the listener's note.

        Asking again among the same pictures with the same note asks nothing; asking
        while a model is asked waits.
        """
        hint = " ".join(hint.split())
        if len(hint) > MAX_HINT:
            message = f"A note to the AI is at most {MAX_HINT} characters."
            raise InvalidInputError(message)
        if CHOOSER not in self._plugins.available_keys().get(PICTURE_CHOOSER.name, []):
            message = "Turn on the ai-details plugin to ask an AI model."
            raise ConflictError(message)
        with self._units() as db:
            name = _name_of(db, artist_id)
            if not is_set_up(db):
                message = "Set up an AI provider in Settings to ask it."
                raise ConflictError(message)
            row = db.get(ArtistPictureSearchRow, (artist_id, SITE.value))
            found = () if row is None else _pictures_of(row)
            if row is None or not found:
                message = "Find the artist's pictures before asking which is of it."
                raise ConflictError(message)
            if _picked_among(row, found) and row.hint == hint:
                return
            artist = db.get_one(ArtistRow, artist_id)
            request = ChoosePictureJob(
                artist_id=artist_id,
                artist=name,
                other_names=_other_names(db, artist_id, name),
                about=", ".join(part for part in (artist.disambiguation, artist.country) if part)[
                    :MAX_NAME
                ],
                songs=_songs_of(db, artist_id),
                hint=hint,
                options=tuple(PictureOption(name=each.name, fans=each.fans) for each in found),
                covers=tuple(each.cover for each in found),
                chooser=CHOOSER,
            )
        self._jobs.submit(self._kinds.choose, choose_picture_target(artist_id), request, caller.id)

    def pictures(self, viewer: Account, artist_id: str) -> ArtistPictures:
        """Return what is known of the pictures of the artist, and what is being asked."""
        with self._units() as db:
            _name_of(db, artist_id)
            row = db.get(ArtistPictureSearchRow, (artist_id, SITE.value))
            settings = read_settings(db)
            turned_on = SITE in settings.picture_sites
            ai = is_set_up(db)
            names = _every_name_of(db, artist_id)
        found = () if row is None else _pictures_of(row)
        pick = None if row is None else _pick_of(row, found)
        finding = self._jobs.latest(FIND_PICTURES_KIND, find_pictures_target(artist_id))
        choosing = self._jobs.latest(CHOOSE_PICTURE_KIND, choose_picture_target(artist_id))
        asking = [job for job in (finding, choosing) if job is not None and job.state.is_active]
        return ArtistPictures(
            pictures=found,
            found_at=None if row is None else row.found_at,
            finding=finding is not None and finding.state.is_active,
            # Asking needs the network, so it waits while medleyplay is Offline.
            waiting=any(job.state is JobState.WAITING or not self._jobs.online() for job in asking),
            failure=_failure(finding, viewer),
            may_find=turned_on,
            pick=pick,
            choosing=choosing is not None and choosing.state.is_active,
            choice_failure=_failure(choosing, viewer),
            may_choose=ai
            and bool(found)
            and CHOOSER in self._plugins.available_keys().get(PICTURE_CHOOSER.name, []),
            suggested=_suggested(names, found, pick),
            auto_pick=settings.pick_pictures_by_ai,
        )

    def missing(self) -> tuple[MissingPhoto, ...]:
        """Return every artist linked to MusicBrainz with no photo, suggested ones first.

        Then most songs first.
        """
        with self._units() as db:
            songs = _without_photo(db, None)
            rows = {
                row.artist_id: row
                for row in db.scalars(
                    select(ArtistPictureSearchRow).where(
                        ArtistPictureSearchRow.artist_id.in_(songs)
                        & (ArtistPictureSearchRow.site == SITE.value)
                    )
                )
            }
            named = {artist_id: _name_of(db, artist_id) for artist_id in songs}
            names = {artist_id: _every_name_of(db, artist_id) for artist_id in songs}
        found: list[MissingPhoto] = []
        for artist_id, count in songs.items():
            row = rows.get(artist_id)
            pictures = () if row is None else _pictures_of(row)
            pick = None if row is None else _pick_of(row, pictures)
            found.append(
                MissingPhoto(
                    artist_id=artist_id,
                    name=named[artist_id],
                    songs=count,
                    suggested=_suggested(names[artist_id], pictures, pick),
                    picked=pick is not None,
                    found=row is not None,
                    finding=self._finding(artist_id),
                )
            )
        found.sort(key=lambda each: (each.suggested is None, -each.songs, each.name))
        return tuple(found)

    def find_missing(self, caller: Account, track_ids: Iterable[int] | None) -> int:
        """Ask the site about the artists with no photo never looked up; return how many.

        `track_ids` names the songs whose artists are asked about, the songs up next,
        while the household has those asked about; `None` asks about every one, while
        the household has every one asked about. Otherwise, or while the site is off,
        nothing is asked.
        """
        wanted = None if track_ids is None else list(dict.fromkeys(track_ids))
        if wanted is not None and len(wanted) > MAX_FIND_TRACKS:
            message = f"Ask about the artists of at most {MAX_FIND_TRACKS} songs at once."
            raise InvalidInputError(message)
        with self._units() as db:
            settings = read_settings(db)
            choice = PhotoSearch.MISSING if wanted is None else PhotoSearch.UP_NEXT
            allowed = (
                SITE in settings.picture_sites
                and settings.find_artist_photos in {choice, PhotoSearch.MISSING}
                and SITE.value in self._plugins.available_keys().get(PICTURE_FINDER.name, [])
            )
            if not allowed:
                return 0
            looked = set(
                db.scalars(
                    select(ArtistPictureSearchRow.artist_id).where(
                        ArtistPictureSearchRow.site == SITE.value
                    )
                )
            )
            asking = [
                (artist_id, _name_of(db, artist_id))
                for artist_id in _without_photo(db, wanted)
                if artist_id not in looked and not self._finding(artist_id)
            ]
        for artist_id, name in asking:
            request = FindPicturesJob(artist_id=artist_id, name=name, finder=SITE.value)
            self._jobs.submit(self._kinds.find, find_pictures_target(artist_id), request, caller.id)
        return len(asking)

    def _finding(self, artist_id: str) -> bool:
        job = self._jobs.latest(FIND_PICTURES_KIND, find_pictures_target(artist_id))
        return job is not None and job.state.is_active


def _name_of(db: Session, artist_id: str) -> str:
    """Return the name the artist is searched by: the household's for it, else MusicBrainz's."""
    artist = db.get(ArtistRow, artist_id)
    if artist is None:
        message = "There is no such artist."
        raise NotFoundError(message)
    household = db.get(ArtistHouseholdRow, artist_id)
    shown = household.shown_as if household is not None else None
    return (shown or artist.name).strip()[:MAX_NAME] or artist.name[:MAX_NAME]


def _failure(job: Job | None, viewer: Account) -> str | None:
    if job is None or job.state is not JobState.FAILED:
        return None
    return failure_shown_to(job, viewer) or None


def _pictures_of(row: ArtistPictureSearchRow) -> tuple[FoundPicture, ...]:
    return tuple(
        FoundPicture(
            name=str(each["name"]),
            fans=None if each.get("fans") is None else int(str(each["fans"])),
            cover=str(each["cover"]),
        )
        for each in row.pictures
    )


def _suggested(
    names: list[str], found: tuple[FoundPicture, ...], pick: PicturePick | None
) -> str | None:
    """Return the cover suggested as the artist's photo: the pick, else the likeliest."""
    if pick is not None:
        return pick.cover
    likeliest = likeliest_picture(names, [(each.name, each.fans) for each in found])
    return None if likeliest is None else found[likeliest].cover


def _without_photo(db: Session, track_ids: list[int] | None) -> dict[str, int]:
    """Return the artists linked to MusicBrainz with no photo, and how many songs each has.

    With `track_ids`, only the artists of those songs.
    """
    bound = (
        select(LibraryArtistRow.musicbrainz_id, func.count(func.distinct(TrackArtistRow.track_id)))
        .join(TrackArtistRow, TrackArtistRow.artist_id == LibraryArtistRow.id)
        .join(ArtistRow, ArtistRow.id == LibraryArtistRow.musicbrainz_id)
        .outerjoin(ArtistHouseholdRow, ArtistHouseholdRow.artist_id == ArtistRow.id)
        .where(ArtistRow.photo.is_(None) & ArtistHouseholdRow.photo.is_(None))
        .group_by(LibraryArtistRow.musicbrainz_id)
    )
    if track_ids is not None:
        bound = bound.where(TrackArtistRow.track_id.in_(track_ids))
    return {artist_id: count for artist_id, count in db.execute(bound) if artist_id is not None}


def _picked_among(row: ArtistPictureSearchRow, found: tuple[FoundPicture, ...]) -> bool:
    """Return whether a model was asked, and shown the pictures found now."""
    return row.chosen_at is not None and list(row.offered) == [each.cover for each in found]


def _pick_of(row: ArtistPictureSearchRow, found: tuple[FoundPicture, ...]) -> PicturePick | None:
    if row.pick is None or row.chosen_at is None or not _picked_among(row, found):
        return None
    return PicturePick(
        cover=row.pick,
        why=row.why,
        model=row.model,
        host=row.host,
        at=row.chosen_at,
        hint=row.hint,
    )


def _every_name_of(db: Session, artist_id: str) -> list[str]:
    """Return every name the artist goes by: the household's for it, MusicBrainz's, and aliases."""
    artist = db.get_one(ArtistRow, artist_id)
    household = db.get(ArtistHouseholdRow, artist_id)
    aliases = db.scalars(select(ArtistAliasRow.name).where(ArtistAliasRow.artist_id == artist_id))
    shown = [household.shown_as] if household is not None and household.shown_as else []
    return [*shown, artist.name, artist.sort_name, *aliases]


def _other_names(db: Session, artist_id: str, name: str) -> tuple[str, ...]:
    """Return a few other names the artist goes by, each once, its primary ones first."""
    rows = db.scalars(
        select(ArtistAliasRow)
        .where(ArtistAliasRow.artist_id == artist_id)
        .order_by(ArtistAliasRow.primary.desc(), ArtistAliasRow.name)
    )
    names: dict[str, str] = {artist_key(name): name}
    for row in rows:
        names.setdefault(artist_key(row.name), row.name.strip()[:MAX_NAME])
    return tuple(each for each in list(names.values())[1:] if each)[:MAX_OTHER_NAMES]


def _songs_of(db: Session, artist_id: str) -> tuple[str, ...]:
    """Return a few of the Library's songs by the artist, each `title — album` or its title."""
    rows = db.execute(
        select(TrackRow.title, TrackRow.album)
        .join(TrackArtistRow, TrackArtistRow.track_id == TrackRow.id)
        .join(LibraryArtistRow, LibraryArtistRow.id == TrackArtistRow.artist_id)
        .where((LibraryArtistRow.musicbrainz_id == artist_id) & (TrackRow.title != ""))
        .distinct()
        .order_by(TrackRow.title)
        .limit(MAX_SONGS_SHOWN)
    )
    return tuple((f"{title} — {album}" if album else title)[:MAX_NAME] for title, album in rows)


def _complete_choice(db: Session, job: Job, result: ChosenPictureResult, *, clock: Clock) -> None:
    """Keep the picture the model picked, with the model that answered and the note it had.

    A pick among pictures other than those found now, as pictures found again since, is
    dropped.
    """
    del job
    row = db.get(ArtistPictureSearchRow, (result.artist_id, SITE.value))
    if row is None or list(result.offered) != [each.cover for each in _pictures_of(row)]:
        return
    named = provider_named(db, result.ai_answered or None)
    model, host = named if named is not None else ("an AI model", "")
    row.offered, row.pick, row.why, row.hint = (
        list(result.offered),
        result.cover,
        result.why,
        result.hint,
    )
    row.model, row.host, row.chosen_at = model, host, clock()


def _complete_find(
    db: Session, job: Job, result: FoundPicturesResult, *, clock: Clock, covers_folder: Path
) -> None:
    """Keep the pictures found of the artist, replacing those found before."""
    del job
    if db.get(ArtistRow, result.artist_id) is None:
        return
    pictures: list[dict[str, object]] = []
    for found in result.pictures:
        try:
            cover = keep_copy(found.picture, covers_folder)
        except NotACoverError:
            continue
        pictures.append({"name": found.name, "fans": found.fans, "cover": cover})
    key = (result.artist_id, result.finder)
    row = db.get(ArtistPictureSearchRow, key) or ArtistPictureSearchRow(
        artist_id=result.artist_id, site=result.finder
    )
    row.pictures, row.found_at = pictures, clock()
    row.offered, row.pick, row.why, row.hint, row.model, row.host = [], None, "", "", "", ""
    row.chosen_at = None
    db.add(row)
