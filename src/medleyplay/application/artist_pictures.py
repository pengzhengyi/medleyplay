"""Pictures of an artist a site has, to choose the household's photo of it from.

Finding is a Job in the site's own lane: the site is asked for pictures of the artists
going by the artist's name, the name the household shows it by, else MusicBrainz's,
and what it finds is kept, the most followed first, each picture kept as a cover is.
Asking again replaces it. A site is asked only once the household has turned it on in
Settings, and nothing changes the artist's photo until the household uses a picture.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta
from functools import partial
from pathlib import Path
from typing import Final

from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application import Clock
from medleyplay.application.jobs import JobKind, JobService, Lane
from medleyplay.application.plugins import PluginService
from medleyplay.application.scan_covers import NotACoverError, keep_copy
from medleyplay.application.settings import read_settings
from medleyplay.domain.accounts import Account
from medleyplay.domain.artists import PictureSite
from medleyplay.domain.errors import ConflictError, NotFoundError
from medleyplay.domain.jobs import Job, JobState, failure_shown_to
from medleyplay.persistence.schema import ArtistHouseholdRow, ArtistPictureSearchRow, ArtistRow
from medleyplay.plugin_api import MAX_NAME, PICTURE_FINDER
from medleyplay.programs.find_pictures import FindPicturesJob, FoundPicturesResult

FIND_PICTURES_KIND: Final = "find_pictures"
SITE: Final = PictureSite.DEEZER
"""The site asked: Deezer, the only one so far."""
SPACING: Final = timedelta(seconds=2)
"""The least time between two findings; each asks the site a few times, a moment apart."""

type FindPicturesKind = JobKind[FindPicturesJob, FoundPicturesResult]


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


@dataclass(frozen=True)
class FoundPicture:
    """A picture of an artist the site knows by `name`, `fans` following it, and its cover."""

    name: str
    fans: int | None
    cover: str


@dataclass(frozen=True)
class ArtistPictures:
    """What is known of the pictures of an artist a site has, and what is being asked.

    `pictures` are those last found, the most followed first, at `found_at`. `finding`
    says the site is asked now, and `waiting` that the asking waits for medleyplay to be
    Online, or to try again. `failure` says why the last asking failed, to the Account
    that asked and to admins. `may_find` says the household turned the site on.
    """

    pictures: tuple[FoundPicture, ...]
    found_at: datetime | None
    finding: bool
    waiting: bool
    failure: str | None
    may_find: bool


class ArtistPictureService:
    """Finds pictures of an artist on the site the household turned on."""

    def __init__(
        self,
        units: sessionmaker[Session],
        plugins: PluginService,
        jobs: JobService,
        kind: FindPicturesKind,
    ) -> None:
        """Create the service, submitting Jobs of `kind` to `jobs`."""
        self._units = units
        self._plugins = plugins
        self._jobs = jobs
        self._kind = kind

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
        self._jobs.submit(self._kind, find_pictures_target(artist_id), request, caller.id)

    def pictures(self, viewer: Account, artist_id: str) -> ArtistPictures:
        """Return what is known of the pictures of the artist, and what is being asked."""
        with self._units() as db:
            _name_of(db, artist_id)
            row = db.get(ArtistPictureSearchRow, (artist_id, SITE.value))
            turned_on = SITE in read_settings(db).picture_sites
        finding = self._jobs.latest(FIND_PICTURES_KIND, find_pictures_target(artist_id))
        asking = finding is not None and finding.state.is_active
        return ArtistPictures(
            pictures=() if row is None else _pictures_of(row),
            found_at=None if row is None else row.found_at,
            finding=asking,
            # Asking needs the network, so it waits while medleyplay is Offline.
            waiting=asking
            and finding is not None
            and (finding.state is JobState.WAITING or not self._jobs.online()),
            failure=_failure(finding, viewer),
            may_find=turned_on,
        )


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
    db.add(row)
