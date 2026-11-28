"""Publish verified audio without overwriting bytes a Download already names."""

# cspell:ignore samefile samestat

import os
import stat
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Final
from uuid import uuid4

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from medleyplay.domain.catalog import TrackId
from medleyplay.domain.errors import InvalidInputError
from medleyplay.domain.jobs import ACTIVE_STATES
from medleyplay.domain.silences import FIND_SILENCES_KIND
from medleyplay.persistence.schema import DownloadRow, JobRow, SilenceRow

_OPEN_FILE: Final = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
_OPEN_FOLDER: Final = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


def publish_staged(
    folder: Path, staged: Path, base_name: str, expected_bytes: int, max_bytes: int
) -> str:
    """Link stopped, staged audio to a fresh name while holding the database writer lock.

    The caller commits the returned name only after the file and directories are durable.
    A failed commit leaves an unreferenced file for startup cleanup.
    """
    folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    name = Path(base_name)
    candidate = f"{name.stem}-{uuid4().hex}{name.suffix}"
    with (
        _directory(staged.parent) as source,
        _directory(folder) as destination,
        _directory(folder.parent.resolve()) as parent,
    ):
        opened = os.open(staged.name, _OPEN_FILE, dir_fd=source)
        try:
            info = os.fstat(opened)
            if (
                not stat.S_ISREG(info.st_mode)
                or not 0 < info.st_size == expected_bytes <= max_bytes
            ):
                message = "The staged download is not a regular file of the expected size."
                raise InvalidInputError(message)
            os.fsync(opened)
            os.link(
                staged.name,
                candidate,
                src_dir_fd=source,
                dst_dir_fd=destination,
                follow_symlinks=False,
            )
            published = os.stat(candidate, dir_fd=destination, follow_symlinks=False)
            if not os.path.samestat(info, published):
                message = "The staged download changed while it was being published."
                raise InvalidInputError(message)
            os.fsync(destination)
            os.fsync(parent)
        finally:
            os.close(opened)
    return candidate


def forget_download_silences(db: Session, track_id: TrackId) -> None:
    """Forget analysis of a file whose replacement is committing."""
    db.execute(delete(SilenceRow).where(SilenceRow.track_id == track_id))


def download_basename(folder: Path, path: str) -> str | None:
    """Return a path's name only if it is directly in the download folder."""
    candidate = Path(path)
    try:
        inside = candidate.parent.samefile(folder)
    except OSError:
        inside = candidate.parent.absolute() == folder.absolute()
    return candidate.name if inside else None


def sweep_download_files(db: Session, folder: Path) -> None:
    """Reclaim unreferenced files before the server admits new uploads or Jobs."""
    db.connection().exec_driver_sql("BEGIN IMMEDIATE")
    named = set(db.scalars(select(DownloadRow.file_name)))
    paths = db.scalars(
        select(JobRow.__table__.c.request["local_path"].as_string()).where(
            JobRow.kind == FIND_SILENCES_KIND, JobRow.state.in_(ACTIVE_STATES)
        )
    )
    for path in paths:
        if isinstance(path, str) and (name := download_basename(folder, path)) is not None:
            named.add(name)
    for entry in folder.iterdir():
        if entry.name not in named and not (entry.is_dir() and not entry.is_symlink()):
            entry.unlink(missing_ok=True)


@contextmanager
def _directory(folder: Path) -> Iterator[int]:
    descriptor = os.open(folder, _OPEN_FOLDER)
    try:
        yield descriptor
    finally:
        os.close(descriptor)
