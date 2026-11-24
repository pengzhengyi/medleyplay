"""Add only selected parts, validating them against saved or directly resolved video metadata."""

import threading
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Final, Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application import Clock
from medleyplay.application.catalog import CatalogService
from medleyplay.application.details import set_household
from medleyplay.application.downloads import DownloadService
from medleyplay.application.plugins import PluginService
from medleyplay.application.segments import keep_as_one
from medleyplay.domain.accounts import Account
from medleyplay.domain.catalog import SourceId, SourceKey, SourceState, TrackDetails, TrackId
from medleyplay.domain.details import Field, Kind, Value, check_value
from medleyplay.domain.downloads import (
    JOIN_ESTIMATE_DETAIL,
    JOIN_OUTPUT_KBPS,
    MAX_DOWNLOAD_BYTES,
    QUALITY_DETAIL,
    quality_kbps,
)
from medleyplay.domain.errors import ConflictError, InvalidInputError, OfflineError, PluginCallError
from medleyplay.domain.jobs import Job
from medleyplay.domain.links import (
    MAX_PART_NUMBER,
    joined_locator,
    lookup_link,
    part_locator,
    recognize_link,
)
from medleyplay.domain.policy import reservation
from medleyplay.persistence.schema import DownloadRow, SourceRow
from medleyplay.plugin_api import (
    BEST_QUALITY,
    CANONICALIZE,
    READ_VIDEO,
    AudioQuality,
    Canonicalize,
    ReadVideo,
    VideoDetails,
)
from medleyplay.programs.lookup_video import Resolved, Unreadable, read_details, read_failure

LOOKUP_MEMORY: Final = timedelta(minutes=10)
MAX_TEXT: Final = 512


class Proxies(Protocol):
    """Where calls to a site find the household's proxy, as `ProxyService` provides."""

    def current(self, site: str) -> str | None:
        """Return the URL calls for `site` go through, or `None` when no proxy is set."""
        ...


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
class AlbumChoice:
    """Album credits and whether the parts are joined into one file."""

    name: str
    artist: str
    joined: bool = False


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
        self.require_online()
        return self.preview(self._resolve(link))

    def preview(self, resolved: Resolved) -> Lookup:
        """Show the saved metadata with parts that are already in the catalog marked."""
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
        self.require_online()
        return self.add_resolved(caller, self._resolve(link), quality, parts)

    def add_resolved(
        self, caller: Account, resolved: Resolved, quality: str, parts: Sequence[PartChoice]
    ) -> list[Added]:
        """Add only the parts chosen from server-held metadata, without another site call."""
        self.require_online()
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

    def require_online(self) -> None:
        """Refuse a new lookup or add while Offline."""
        if not self._online():
            message = "medleyplay is Offline, so links wait until it is Online."
            raise OfflineError(message)

    def import_in(
        self,
        db: Session,
        caller: Account,
        resolved: Resolved,
        quality: str,
        album: AlbumChoice | None,
        numbers: Sequence[int] | None,
    ) -> list[Added]:
        """Add the selected new parts and their Jobs together, under the caller's write lock."""
        self.require_online()
        if album is not None and album.joined:
            return [self._join_in(db, caller, resolved, quality, album, numbers)]
        return self._separate_in(db, caller, resolved, quality, album, numbers)

    def _separate_in(
        self,
        db: Session,
        caller: Account,
        resolved: Resolved,
        quality: str,
        album: AlbumChoice | None,
        numbers: Sequence[int] | None,
    ) -> list[Added]:
        read = _readable(resolved)
        if album is not None and (not album.name.strip() or len(read.parts) <= 1):
            message = "An album needs a name and a video with several parts."
            raise InvalidInputError(message)
        parts = _import_choices(read, resolved.video, numbers)
        _check_choice(read, quality, parts)
        if album:
            check_value(Field.ALBUM, album.name)
            check_value(Field.ALBUM_ARTIST, album.artist)
        durations = {part.part: part.duration_ms for part in read.parts}
        added = []
        for number, choice in enumerate(parts, 1):
            key = SourceKey(resolved.kind, part_locator(resolved.video, choice.part))
            if db.scalar(
                select(SourceRow.id).where(
                    SourceRow.kind == key.kind, SourceRow.locator == key.locator
                )
            ):
                if album:
                    message = f"Part {choice.part} is already in the Library. Deselect it."
                    raise ConflictError(message)
                continue
            source = self._catalog.insert_in(
                db,
                key,
                TrackDetails(choice.title, duration_ms=durations[choice.part]),
                {QUALITY_DETAIL: quality},
            )
            track_id = TrackId(source.track_id)
            if album:
                values: dict[Field, Value | None] = {
                    Field.KIND: Kind.SONG,
                    Field.ALBUM: album.name.strip(),
                    Field.TRACK_NUMBER: number,
                    Field.TITLE: choice.title,
                    Field.ALBUM_ARTIST: album.artist.strip(),
                }
                set_household(db, track_id, values, self._clock())
            else:
                keep_as_one(db, track_id, self._clock())
            job = self._downloads.queue_new_in(db, caller, source)
            if job is None:
                message = "No downloader is available. Enable one before downloading."
                raise ConflictError(message)
            added.append(Added(choice.part, track_id, SourceId(source.id), job))
        if not added:
            message = "All parts are already in the Library."
            raise ConflictError(message)
        return added

    def _join_in(
        self,
        db: Session,
        caller: Account,
        resolved: Resolved,
        quality: str,
        album: AlbumChoice,
        numbers: Sequence[int] | None,
    ) -> Added:
        read = _readable(resolved)
        selected = tuple(sorted(numbers or ()))
        _check_selection(read, quality, selected)
        name, artist = album.name.strip(), album.artist.strip()
        if not name:
            message = "An album needs a name."
            raise InvalidInputError(message)
        check_value(Field.ALBUM, name)
        check_value(Field.ALBUM_ARTIST, artist)
        key = SourceKey(resolved.kind, joined_locator(resolved.video, selected))
        existing = db.scalar(
            select(SourceRow).where(SourceRow.kind == key.kind, SourceRow.locator == key.locator)
        )
        if existing is not None:
            source_id = SourceId(existing.id)
            return Added(
                selected[0],
                TrackId(existing.track_id),
                source_id,
                self._downloads.active_in(db, source_id),
            )
        durations = {part.part: part.duration_ms for part in read.parts}
        lengths = [durations[part] for part in selected]
        known = [length for length in lengths if length is not None and length > 0]
        duration = sum(known) if len(known) == len(lengths) else None
        kbps = JOIN_OUTPUT_KBPS if len(selected) > 1 else quality_kbps(quality)
        estimate = min(MAX_DOWNLOAD_BYTES, sum(reservation(n, kbps) for n in lengths))
        source = self._catalog.insert_in(
            db,
            key,
            TrackDetails(name, duration_ms=duration),
            {
                QUALITY_DETAIL: quality,
                JOIN_ESTIMATE_DETAIL: estimate,
            },
        )
        track_id = TrackId(source.track_id)
        set_household(
            db,
            track_id,
            {
                Field.KIND: Kind.ALBUM,
                Field.TITLE: name,
                Field.ALBUM: name,
                Field.ALBUM_ARTIST: artist,
            },
            self._clock(),
        )
        keep_as_one(db, track_id, self._clock())
        job = self._downloads.queue_new_in(db, caller, source)
        if job is None:
            message = "No downloader is available. Enable one before downloading."
            raise ConflictError(message)
        return Added(selected[0], track_id, SourceId(source.id), job)

    def announce_import(self) -> None:
        """Publish the catalog change after an import commits."""
        self._catalog.announce_added()

    def _resolve(self, link: str) -> Resolved:
        link = lookup_link(link)
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
        return Resolved(kind=kind, video=canonical.video, part=canonical.part, read=read)

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
                read: _Read = read_failure(error.kind, str(error))
            else:
                read = read_details(details)
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


def _import_choices(
    read: VideoDetails, video: str, numbers: Sequence[int] | None
) -> list[PartChoice]:
    known = {part.part: part.title if len(read.parts) > 1 else read.title for part in read.parts}
    chosen = sorted(known if numbers is None else numbers)
    if unknown := sorted(set(chosen) - known.keys()):
        message = f"The video has no part {unknown[0]}."
        raise InvalidInputError(message)
    return [PartChoice(part, known[part].strip() or f"{video} P{part}", "") for part in chosen]


def _readable(resolved: Resolved) -> VideoDetails:
    if isinstance(resolved.read, Unreadable):
        message = "This video has no readable part list. Enter the parts yourself."
        raise InvalidInputError(message)
    return resolved.read


def _check_choice(details: VideoDetails, quality: str, parts: Sequence[PartChoice]) -> None:
    _check_selection(details, quality, [part.part for part in parts])
    _check_texts(parts)


def _check_selection(details: VideoDetails, quality: str, numbers: Sequence[int]) -> None:
    _check_numbers(numbers)
    known = {part.part for part in details.parts}
    if unknown := sorted(set(numbers) - known):
        message = f"The video has no part {unknown[0]}."
        raise InvalidInputError(message)
    if quality != BEST_QUALITY and quality not in {each.id for each in details.qualities}:
        message = f"The video can't be added at the quality {quality!r}."
        raise InvalidInputError(message)


def _check_unreadable_choice(quality: str, parts: Sequence[PartChoice]) -> None:
    """Check the household's details for a video the site can't be asked about."""
    numbers = [part.part for part in parts]
    _check_numbers(numbers)
    if not all(1 <= number <= MAX_PART_NUMBER for number in numbers):
        message = f"A part number is 1 to {MAX_PART_NUMBER}."
        raise InvalidInputError(message)
    if quality != BEST_QUALITY:
        message = "A video that can't be read is added at the quality best."
        raise InvalidInputError(message)
    _check_texts(parts)


def _check_numbers(numbers: Sequence[int]) -> None:
    if not numbers or len(set(numbers)) != len(numbers):
        message = "Choose one or more different parts."
        raise InvalidInputError(message)


def _check_texts(parts: Sequence[PartChoice]) -> None:
    for choice in parts:
        if not 1 <= len(choice.title.strip()) <= MAX_TEXT or len(choice.artist) > MAX_TEXT:
            message = f"A title is 1 to {MAX_TEXT} characters, and an artist at most {MAX_TEXT}."
            raise InvalidInputError(message)
