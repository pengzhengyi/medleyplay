"""Household Tavily settings and explicitly requested web picture searches."""

from dataclasses import dataclass
from datetime import timedelta
from typing import Final

from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.album_covers import album_key
from medleyplay.application.jobs import JobKind, JobService, Lane
from medleyplay.application.plugins import PluginService
from medleyplay.application.secrets import Secrets
from medleyplay.domain.accounts import Account
from medleyplay.domain.ai import check_key
from medleyplay.domain.errors import ConflictError, ForbiddenError, InvalidInputError
from medleyplay.domain.jobs import Job, JobState, failure_shown_to
from medleyplay.persistence.schema import PictureSearchRow
from medleyplay.plugin_api.image_search import (
    IMAGE_SEARCHER,
    TAVILY,
    PictureCandidate,
    PictureResults,
)
from medleyplay.programs.image_search import PictureSearchJob

_KEY: Final = "image-search:tavily"


class TavilyKeys:
    """Keep the household's optional provider key only in Secrets."""

    def __init__(self, secrets: Secrets) -> None:
        """Use the server's secret store."""
        self._secrets = secrets

    def configured(self) -> bool:
        """Return only whether a key has been saved."""
        return self.lend() is not None

    def lend(self) -> str | None:
        """Read the key for the isolated search process."""
        return self._secrets.get(_KEY)

    def set(self, caller: Account, key: str) -> None:
        """Save or replace the key without contacting the provider."""
        _require_admin(caller)
        checked = check_key(key)
        if not checked.isascii():
            message = "A provider key must contain only ASCII characters."
            raise InvalidInputError(message)
        self._secrets.set(_KEY, checked)

    def remove(self, caller: Account) -> None:
        """Forget the key without changing any results."""
        _require_admin(caller)
        self._secrets.delete(_KEY)


def _require_admin(caller: Account) -> None:
    if not caller.is_admin:
        message = "Only an admin can change the picture search key."
        raise ForbiddenError(message)


def _complete(db: Session, job: Job, result: PictureResults) -> None:
    db.merge(
        PictureSearchRow(
            key=job.target, images=[image.model_dump(mode="json") for image in result.images]
        )
    )


IMAGE_SEARCH: Final = JobKind(
    name="image_search",
    request=PictureSearchJob,
    result=PictureResults,
    program="medleyplay.programs.image_search:SEARCH",
    complete=_complete,
    points=(IMAGE_SEARCHER.name,),
    needs_network=True,
    lane_field="provider",
    lanes={TAVILY: Lane(spacing=timedelta(seconds=2))},
    lends_tavily=True,
)


@dataclass(frozen=True)
class SearchState:
    """The last source-linked results and the state of the latest search."""

    searching: bool
    waiting: bool
    failure: str | None
    images: tuple[PictureCandidate, ...]


class ImageSearchService:
    """Queue a search only on request and read its last successful results."""

    def __init__(
        self,
        units: sessionmaker[Session],
        plugins: PluginService,
        jobs: JobService,
        keys: TavilyKeys,
    ) -> None:
        """Use the search plugin, Job queue, and household key."""
        self._units = units
        self._plugins = plugins
        self._jobs = jobs
        self.keys = keys

    def search(self, caller: Account, album: str, artist: str) -> None:
        """Submit a paced network Job, sharing an already active search for this target."""
        request = _subject(album, artist)
        if not self.keys.configured():
            message = "Set the Tavily key in Settings to search for pictures."
            raise ConflictError(message)
        if TAVILY not in self._plugins.plugins_for(IMAGE_SEARCH.points):
            message = "Enable the Tavily plugin to search for pictures."
            raise ConflictError(message)
        self._jobs.submit(
            IMAGE_SEARCH, album_key(request.album, request.artist), request, caller.id
        )

    def results(self, viewer: Account, album: str, artist: str) -> SearchState:
        """Return saved results without contacting Tavily or reading a key."""
        request = _subject(album, artist)
        key = album_key(request.album, request.artist)
        with self._units() as db:
            row = db.get(PictureSearchRow, key)
            images = tuple(PictureCandidate.model_validate(x) for x in row.images) if row else ()
        job = self._jobs.latest(IMAGE_SEARCH.name, key)
        active = job is not None and job.state.is_active
        return SearchState(
            searching=active,
            waiting=active
            and job is not None
            and (job.state is JobState.WAITING or not self._jobs.online()),
            failure=(failure_shown_to(job, viewer) or None)
            if job and job.state is JobState.FAILED
            else None,
            images=images,
        )


def _subject(album: str, artist: str) -> PictureSearchJob:
    album, artist = " ".join(album.split()), " ".join(artist.split())
    if not album and not artist:
        message = "Name the album or artist to search for pictures."
        raise InvalidInputError(message)
    return PictureSearchJob(album=album, artist=artist)
