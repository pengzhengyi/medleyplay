"""A site Track's Download as the household sees it, and the file they add by hand.

A file is received into a temporary name beside the Downloads, checked, and then
renamed over `downloads/<source id>.<ext>` in the transaction that records it, which
also cancels the Source's active download Job. A crash before the commit leaves a file
no Download names, which the sweep at startup removes.
"""

import os
import struct
import types
import uuid
from collections.abc import Callable
from dataclasses import dataclass, replace
from enum import StrEnum
from pathlib import Path
from typing import Final, Self

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker
from tinytag import TinyTag, TinyTagException

from medleyplay.application import Clock
from medleyplay.application.changes import OnChange
from medleyplay.application.downloads import DOWNLOAD_KIND
from medleyplay.application.jobs import JobService
from medleyplay.domain.catalog import SourceId, SourceState, TrackId
from medleyplay.domain.downloads import (
    MANUAL_BACKEND,
    MAX_DOWNLOAD_BYTES,
    download_target,
    manual_download_name,
)
from medleyplay.domain.errors import ConflictError, InvalidInputError, NotFoundError, TooLargeError
from medleyplay.domain.jobs import JobState
from medleyplay.domain.links import PART_LINKS, part_link
from medleyplay.persistence.schema import DownloadRow, SourceRow, TrackRow

_UPLOAD_PREFIX: Final = ".upload-"
_UNAVAILABLE: Final = "The site no longer has this video."
_FAILED: Final = "The download failed."


class DownloadStatus(StrEnum):
    """Where a site Source's Download stands."""

    DOWNLOADED = "downloaded"
    DOWNLOADING = "downloading"
    """A Job is waiting, queued, or running to download it."""
    FAILED = "failed"
    """It has no Download, and the last Job downloading it failed."""
    UNAVAILABLE = "unavailable"
    """It has no Download, and the site no longer has the video."""
    NONE = "none"
    """It has no Download, and nothing is downloading it."""


@dataclass(frozen=True)
class TrackDownload:
    """A Track's site Source, its link, and where its Download stands.

    `message` is why a Download failed or is unavailable, and `backend` names what
    made a Download that exists.
    """

    track_id: TrackId
    source_id: SourceId
    kind: str
    link: str
    status: DownloadStatus
    message: str = ""
    backend: str | None = None


def audio_length_ms(path: Path) -> int:
    """Return the length of the audio file at `path` in milliseconds.

    tinytag reads it as the type its extension names: `night.mp3` is read as MP3. A file
    it can't read as that type, or reads with no length, raises `InvalidInputError`.
    """
    try:
        seconds = TinyTag.get(str(path)).duration
    except (TinyTagException, ValueError, struct.error, EOFError, IndexError, OSError):
        seconds = None
    if seconds is None or seconds <= 0:
        message = "medleyplay can't read this file as audio with a length."
        raise InvalidInputError(message)
    return max(1, round(seconds * 1000))


class ManualDownloadService:
    """Report a Track's Download, and take the file the household adds as its Download."""

    def __init__(
        self,
        units: sessionmaker[Session],
        clock: Clock,
        jobs: JobService,
        folder: Path,
        on_change: OnChange | None = None,
        *,
        max_bytes: int = MAX_DOWNLOAD_BYTES,
    ) -> None:
        """Create a service keeping files in `folder`, the Downloads folder.

        A file larger than `max_bytes` is refused as it arrives. What a file changed is
        told to `on_change` once it is kept.
        """
        self._units = units
        self._clock = clock
        self._jobs = jobs
        self._folder = folder
        self._on_change = on_change
        self._max_bytes = max_bytes

    @property
    def max_bytes(self) -> int:
        """The most bytes a file may have."""
        return self._max_bytes

    def state(self, track_id: TrackId) -> TrackDownload:
        """Return where the Track's site Source stands: downloaded, downloading, or failed.

        A Track without a site Source raises `ConflictError`.
        """
        with self._units() as db:
            source = _site_source(db, track_id)
            download = db.get(DownloadRow, source.id)
        none = TrackDownload(
            track_id=track_id,
            source_id=SourceId(source.id),
            kind=source.kind,
            link=part_link(source.kind, source.locator),
            status=DownloadStatus.NONE,
        )
        if download is not None:
            return replace(none, status=DownloadStatus.DOWNLOADED, backend=download.backend)
        latest = self._jobs.latest(DOWNLOAD_KIND, download_target(SourceId(source.id)))
        if latest is not None and latest.state.is_active:
            return replace(none, status=DownloadStatus.DOWNLOADING)
        if latest is not None and latest.state is JobState.FAILED:
            message = latest.failure_message or _FAILED
            return replace(none, status=DownloadStatus.FAILED, message=message)
        if source.state == SourceState.UNAVAILABLE:
            return replace(none, status=DownloadStatus.UNAVAILABLE, message=_UNAVAILABLE)
        return none

    def upload(self, track_id: TrackId, name: str) -> "Upload":
        """Return an upload of the Track's file, which `name` is the name of.

        Open it with `with`, `write` the file's bytes, and `finish` to keep it. A Track
        that doesn't exist raises `NotFoundError`, one without a site Source
        `ConflictError`, and a name without an accepted extension `InvalidInputError`.
        """
        with self._units() as db:
            source_id = SourceId(_site_source(db, track_id).id)
        file_name = manual_download_name(source_id, name)

        def keep(received: Path, length_ms: int) -> TrackDownload:
            self._keep(track_id, source_id, file_name, received, length_ms)
            return self.state(track_id)

        return Upload(self._folder, file_name, self._max_bytes, keep)

    def _keep(
        self, track_id: TrackId, source_id: SourceId, name: str, received: Path, length_ms: int
    ) -> None:
        """Rename the received file over the Source's Download, and record it."""
        size = received.stat().st_size
        with self._units.begin() as db:
            # The first statement, so the write lock is held before a file is renamed.
            cancelled = self._jobs.cancel_active_in(db, DOWNLOAD_KIND, download_target(source_id))
            previous = db.get(DownloadRow, source_id)
            replaced = None if previous is None else previous.file_name
            received.replace(self._folder / name)
            row = previous or DownloadRow(source_id=source_id)
            row.file_name, row.quality, row.backend = name, "", MANUAL_BACKEND
            row.size, row.downloaded_at = size, self._clock()
            db.add(row)
            track = db.get_one(TrackRow, track_id)
            if track.duration_ms is None:
                track.duration_ms = length_ms
        if replaced is not None and replaced != name:
            (self._folder / replaced).unlink(missing_ok=True)
        if cancelled is not None:
            self._jobs.announce_cancelled(cancelled)
        if self._on_change is not None:
            self._on_change("catalog")


class Upload:
    """A file arriving as a Track's Download: a context manager that cleans up after itself.

    ```python
    with service.upload(track_id, "night.wav") as upload:
        upload.write(first_bytes)
        upload.write(the_rest)
        upload.finish()
    ```
    """

    def __init__(
        self,
        folder: Path,
        name: str,
        max_bytes: int,
        keep: Callable[[Path, int], TrackDownload],
    ) -> None:
        """Prepare an upload, to be kept as the Download `name`, received into `folder`.

        The file has at most `max_bytes`. `keep` takes the received file and its length
        in milliseconds, once it is checked, and returns where the Track's Download
        stands. The received file ends as `name` does, so it is read as the type it claims.
        """
        self._max_bytes = max_bytes
        self._keep = keep
        self._path = folder / f"{_UPLOAD_PREFIX}{uuid.uuid4().hex}{Path(name).suffix}"
        self._descriptor: int | None = None
        self._size = 0

    def __enter__(self) -> Self:
        """Create the temporary file beside the Downloads."""
        self._path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
        self._descriptor = os.open(self._path, flags, 0o600)
        return self

    def __exit__(
        self,
        kind: type[BaseException] | None,
        error: BaseException | None,
        traceback: types.TracebackType | None,
    ) -> None:
        """Close and remove the temporary file, if it is still there."""
        self._close()
        self._path.unlink(missing_ok=True)

    def write(self, chunk: bytes) -> None:
        """Add the next bytes of the file; bytes past the limit raise `TooLargeError`."""
        descriptor = self._open()
        self._size += len(chunk)
        if self._size > self._max_bytes:
            message = f"The file is larger than the {self._max_bytes:,} bytes medleyplay accepts."
            raise TooLargeError(message)
        view = memoryview(chunk)
        while view:
            view = view[os.write(descriptor, view) :]

    def finish(self) -> TrackDownload:
        """Check the file and keep it as the Track's Download; return where it stands.

        An empty file, or one that isn't audio with a length, raises `InvalidInputError`.
        """
        descriptor = self._open()
        if self._size == 0:
            message = "The file is empty."
            raise InvalidInputError(message)
        os.fsync(descriptor)
        self._close()
        return self._keep(self._path, audio_length_ms(self._path))

    def _open(self) -> int:
        if self._descriptor is None:
            message = "The upload isn't open."
            raise ValueError(message)
        return self._descriptor

    def _close(self) -> None:
        if self._descriptor is not None:
            os.close(self._descriptor)
            self._descriptor = None


def _site_source(db: Session, track_id: TrackId) -> SourceRow:
    """Return the Track's first site Source."""
    if db.get(TrackRow, track_id) is None:
        message = f"No Track has the id {track_id}."
        raise NotFoundError(message)
    source = db.scalars(
        select(SourceRow)
        .where(SourceRow.track_id == track_id, SourceRow.kind.in_(PART_LINKS))
        .order_by(SourceRow.id)
        .limit(1)
    ).first()
    if source is None:
        message = "This Track has no Source on a site, so it has no Download to add."
        raise ConflictError(message)
    return source
