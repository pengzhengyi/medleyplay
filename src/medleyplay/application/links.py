"""Adding music from a link: looking a video up, then adding the parts the household chose.

The core recognizes the link by its host before any plugin sees it, and checks
the link the plugin ended on again. Adding doesn't trust the client: it reads
the video again, from a short memory of recent lookups, and checks every part and
the quality against it. A video the site can't be asked about is looked up and
added all the same, on the household's own details for its parts.
"""

import threading
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum
from typing import Final, Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application import Clock
from medleyplay.application.catalog import CatalogService
from medleyplay.application.downloads import QUALITY_DETAIL, DownloadService
from medleyplay.application.plugins import PluginService
from medleyplay.domain.accounts import Account
from medleyplay.domain.catalog import SourceId, SourceKey, SourceState, TrackDetails, TrackId
from medleyplay.domain.errors import InvalidInputError, OfflineError, PluginCallError
from medleyplay.domain.jobs import Job
from medleyplay.domain.links import link_of, part_locator, recognize_link
from medleyplay.persistence.schema import DownloadRow, SourceRow
from medleyplay.plugin_api import (
    BEST_QUALITY,
    CANONICALIZE,
    READ_VIDEO,
    AudioQuality,
    Canonicalize,
    ReadVideo,
    VideoDetails,
    VideoStatus,
)

LOOKUP_MEMORY: Final = timedelta(minutes=10)
MAX_PARTS_PER_ADD: Final = 50
MAX_TEXT: Final = 512
MAX_PART_NUMBER: Final = 9999


class Proxies(Protocol):
    """Where calls to a site find the household's proxy, as `ProxyService` provides."""

    def current(self, site: str) -> str | None:
        """Return the URL calls for `site` go through, or `None` when no proxy is set."""
        ...


class Reason(StrEnum):
    """Why a video couldn't be read."""

    GONE = "gone"
    """The site no longer has it."""
    NEEDS_LOGIN = "needs_login"
    NETWORK = "network"
    """The site couldn't be reached."""
    REFUSED = "refused"
    """The site refused the read."""
    FAULT = "fault"
    """The plugin failed."""


@dataclass(frozen=True)
class Unreadable:
    """Why a video couldn't be read, in the site's or the plugin's words."""

    reason: Reason
    message: str


_REASON_OF_FAILURE: Final[dict[str, Reason]] = {
    "network": Reason.NETWORK,
    "auth": Reason.REFUSED,
    "plugin": Reason.FAULT,
}
_REASON_OF_STATUS: Final = {
    VideoStatus.GONE: Reason.GONE,
    VideoStatus.NEEDS_LOGIN: Reason.NEEDS_LOGIN,
}


@dataclass(frozen=True)
class PartLookup:
    """One part of a looked-up video, and its Track when it is already in the catalog."""

    part: int
    title: str
    duration_ms: int | None
    track_id: TrackId | None


@dataclass(frozen=True)
class Lookup:
    """A video a link names: its details, its parts, and the qualities it can be added at.

    A video that couldn't be read has `unreadable` saying why, no title or uploader or
    qualities, and one part: the one the link names, or part 1.
    """

    kind: str
    video: str
    title: str
    uploader: str
    parts: tuple[PartLookup, ...]
    qualities: tuple[AudioQuality, ...]
    unreadable: Unreadable | None = None


@dataclass(frozen=True)
class PartChoice:
    """A part the household chose to add, under the title and artist it chose."""

    part: int
    title: str
    artist: str


@dataclass(frozen=True)
class Added:
    """A part's Track and Source, and the Job downloading it when one is needed."""

    part: int
    track_id: TrackId
    source_id: SourceId
    job: Job | None


type _Read = VideoDetails | Unreadable


@dataclass(frozen=True)
class _Remembered:
    read: _Read
    read_at: datetime


@dataclass(frozen=True)
class _Resolved:
    kind: str
    video: str
    part: int | None
    read: _Read


class LinkService:
    """Look links up, and add the parts the household chose as Tracks."""

    def __init__(
        self,
        units: sessionmaker[Session],
        clock: Clock,
        plugins: PluginService,
        catalog: CatalogService,
        downloads: DownloadService,
        online: Callable[[], bool] = lambda: True,
        proxies: Proxies | None = None,
    ) -> None:
        """Create a service that adds Tracks to `catalog` and downloads them with `downloads`.

        While `online` says the Mode is Offline, looking up and adding links are refused.
        Calls to a site go through its proxy in `proxies`, when it has one.
        """
        self._units = units
        self._clock = clock
        self._plugins = plugins
        self._catalog = catalog
        self._downloads = downloads
        self._online = online
        self._proxies = proxies
        # One lookup at a time: the plugin host answers one call at a time anyway,
        # and a burst of lookups shouldn't reach the site at once.
        self._reading = threading.Lock()
        self._remembered: dict[tuple[str, str], _Remembered] = {}

    def forget_lookups(self) -> None:
        """Forget the videos looked up, so the next lookup asks the site again."""
        self._remembered = {}

    def lookup(self, caller: Account, link: str) -> Lookup:
        """Return the video `link` names, with each part's Track if it is already added.

        A link that isn't a video raises `InvalidInputError`; Offline, it raises
        `OfflineError`. A video that can't be read, because it is gone, needs a login,
        or the site refuses or can't be reached, is answered all the same, with
        `unreadable` saying why.
        """
        del caller  # Any signed-in Account may look a link up.
        self._require_online()
        resolved = self._resolve(link)
        kind, video, read = resolved.kind, resolved.video, resolved.read
        if isinstance(read, Unreadable):
            part = resolved.part or 1
            track = self._tracks(kind, [part_locator(video, part)]).get(part_locator(video, part))
            return Lookup(
                kind, video, "", "", (PartLookup(part, "", None, track),), (), unreadable=read
            )
        tracks = self._tracks(kind, [part_locator(video, part.part) for part in read.parts])
        return Lookup(
            kind=kind,
            video=video,
            title=read.title,
            uploader=read.uploader,
            parts=tuple(
                PartLookup(
                    part.part,
                    part.title,
                    part.duration_ms,
                    tracks.get(part_locator(video, part.part)),
                )
                for part in read.parts
            ),
            qualities=read.qualities,
        )

    def add(
        self, caller: Account, link: str, quality: str, parts: Sequence[PartChoice]
    ) -> list[Added]:
        """Add the chosen parts as Tracks, and start downloading each one without a Download.

        A part already in the catalog keeps its Track and quality, and adding again
        returns the same Tracks and Jobs. Offline, it raises `OfflineError`.

        A video that can't be read is added on the household's details alone, at the
        quality `best`, and its parts have no duration until a file comes.
        """
        self._require_online()
        resolved = self._resolve(link)
        kind, video, read = resolved.kind, resolved.video, resolved.read
        if isinstance(read, Unreadable):
            _check_unreadable_choice(quality, parts)
            durations: dict[int, int | None] = {}
        else:
            _check_choice(read, quality, parts)
            durations = {part.part: part.duration_ms for part in read.parts}
        added = []
        for choice in parts:
            key = SourceKey(kind, part_locator(video, choice.part))
            track_id = self._catalog.add_track(
                key,
                TrackDetails(
                    title=choice.title.strip(),
                    artist=choice.artist.strip(),
                    duration_ms=durations.get(choice.part),
                ),
                {QUALITY_DETAIL: quality},
            )
            source_id, needs_download = self._source(key)
            job = self._downloads.start(caller, source_id) if needs_download else None
            added.append(Added(choice.part, track_id, source_id, job))
        return added

    def _require_online(self) -> None:
        if not self._online():
            message = "medleyplay is Offline, so links wait until it is Online."
            raise OfflineError(message)

    def _resolve(self, link: str) -> _Resolved:
        link = link_of(link)
        kind = recognize_link(link)
        # Read before any call, so a slow Keychain never holds up the plugin host.
        proxy = self._proxies.current(kind) if self._proxies is not None else None
        canonical = self._plugins.call(
            CANONICALIZE, kind, Canonicalize(link=link.strip(), proxy=proxy)
        )
        # The plugin may have followed a short link; where it ended must be the site too.
        if recognize_link(canonical.link) != kind:  # pragma: no cover -- one kind per host
            raise InvalidInputError(canonical.link)
        if canonical.video is None:
            message = "The link doesn't name a video."
            raise InvalidInputError(message)
        read = self._read(kind, canonical.video, proxy)
        return _Resolved(kind, canonical.video, canonical.part, read)

    def _read(self, kind: str, video: str, proxy: str | None) -> _Read:
        """Read the video, or say why it can't be read; either is remembered."""
        with self._reading:
            now = self._clock()
            remembered = self._remembered.get((kind, video))
            if remembered is not None and now - remembered.read_at < LOOKUP_MEMORY:
                return remembered.read
            try:
                details = self._plugins.call(READ_VIDEO, kind, ReadVideo(video=video, proxy=proxy))
            except PluginCallError as error:
                read: _Read = Unreadable(_REASON_OF_FAILURE[error.kind], str(error))
            else:
                read = details if details.status is VideoStatus.OK else _unreadable(details)
            self._remembered = {
                key: kept
                for key, kept in self._remembered.items()
                if now - kept.read_at < LOOKUP_MEMORY
            }
            self._remembered[kind, video] = _Remembered(read, now)
            return read

    def _tracks(self, kind: str, locators: list[str]) -> dict[str, TrackId]:
        with self._units() as db:
            rows = db.execute(
                select(SourceRow.locator, SourceRow.track_id).where(
                    SourceRow.kind == kind, SourceRow.locator.in_(locators)
                )
            ).all()
        return {locator: TrackId(track_id) for locator, track_id in rows}

    def _source(self, key: SourceKey) -> tuple[SourceId, bool]:
        """Return the Source's id, and whether it needs downloading."""
        with self._units() as db:
            row = db.scalars(
                select(SourceRow).where(
                    SourceRow.kind == key.kind, SourceRow.locator == key.locator
                )
            ).one()
            downloaded = db.get(DownloadRow, row.id) is not None
            return SourceId(row.id), not downloaded and row.state != SourceState.UNAVAILABLE


def _unreadable(details: VideoDetails) -> Unreadable:
    return Unreadable(
        _REASON_OF_STATUS[details.status], details.message or f"The video is {details.status}."
    )


def _check_choice(details: VideoDetails, quality: str, parts: Sequence[PartChoice]) -> None:
    numbers = _check_numbers(parts)
    known = {part.part for part in details.parts}
    if unknown := sorted(set(numbers) - known):
        message = f"The video has no part {unknown[0]}."
        raise InvalidInputError(message)
    if quality != BEST_QUALITY and quality not in {each.id for each in details.qualities}:
        message = f"The video can't be added at the quality {quality!r}."
        raise InvalidInputError(message)
    _check_texts(parts)


def _check_unreadable_choice(quality: str, parts: Sequence[PartChoice]) -> None:
    """Check the household's details for a video the site can't be asked about."""
    numbers = _check_numbers(parts)
    if not all(1 <= number <= MAX_PART_NUMBER for number in numbers):
        message = f"A part number is 1 to {MAX_PART_NUMBER}."
        raise InvalidInputError(message)
    if quality != BEST_QUALITY:
        message = "A video that can't be read is added at the quality best."
        raise InvalidInputError(message)
    _check_texts(parts)


def _check_numbers(parts: Sequence[PartChoice]) -> list[int]:
    numbers = [choice.part for choice in parts]
    if not 1 <= len(numbers) <= MAX_PARTS_PER_ADD or len(set(numbers)) != len(numbers):
        message = f"Choose 1 to {MAX_PARTS_PER_ADD} different parts."
        raise InvalidInputError(message)
    return numbers


def _check_texts(parts: Sequence[PartChoice]) -> None:
    for choice in parts:
        if not 1 <= len(choice.title.strip()) <= MAX_TEXT or len(choice.artist) > MAX_TEXT:
            message = f"A title is 1 to {MAX_TEXT} characters, and an artist at most {MAX_TEXT}."
            raise InvalidInputError(message)
