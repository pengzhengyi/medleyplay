"""Reading a Library's files for a scan: a file's bytes, whole, from a folder or an archive."""

import shutil
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path, PurePosixPath

from medleyplay.plugin_api import (
    FETCH_FILE,
    LOCATE_FILE,
    FetchFile,
    FileRequest,
    LibraryFile,
    LibraryPath,
    LibraryRoot,
)
from medleyplay.plugin_host.job import JobContext, PluginCallFailedError


class FileGoneError(Exception):
    """The file was listed, and is gone when it is read."""


class FileTooLargeError(Exception):
    """The file is longer than the most that may be read."""

    def __init__(self, size: int, limit: int) -> None:
        """Record the file's size and the limit it is over."""
        super().__init__(f"{size:,} bytes; at most {limit:,} are read")
        self.size = size
        self.limit = limit


def extension_of(path: str) -> str:
    """Return the path's extension in lower case, without its dot: `Blue/A.M4A` is `m4a`."""
    return PurePosixPath(path).suffix.lower().removeprefix(".")


def name_of(path: str) -> str:
    """Return the path without its extension: `Blue/a.m4a` is `Blue/a`."""
    suffix = PurePosixPath(path).suffix
    return path.removesuffix(suffix) if suffix else path


def read_whole(root: LibraryRoot, file: LibraryFile, context: JobContext, limit: int) -> bytes:
    """Return the file's bytes; raise `FileGoneError` or `FileTooLargeError` when it can't be read.

    A file over `limit` bytes is refused by its listed size and its located length
    before any of it is read.
    """
    _require_within(file.size, limit)
    location = context.call(LOCATE_FILE, root.kind, FileRequest(root=root, path=file.path))
    if location.missing:
        raise FileGoneError
    _require_within(location.length, limit)
    if location.compressed or location.local_path is None:
        with fetched(root, file.path, context) as copy, copy.open("rb") as handle:
            data = handle.read(limit + 1)
    else:
        with Path(location.local_path).open("rb") as handle:
            handle.seek(location.offset)
            data = handle.read(location.length)
    _require_within(len(data), limit)
    return data


@contextmanager
def fetched(root: LibraryRoot, path: LibraryPath, context: JobContext) -> Iterator[Path]:
    """Copy the file into a folder of the Job's, yield the copy, and remove it afterwards."""
    folder = context.work_dir / "fetched"
    folder.mkdir(exist_ok=True)
    try:
        copy = context.call(
            FETCH_FILE, root.kind, FetchFile(root=root, path=path, folder=str(folder))
        )
        local = Path(copy.local_path).resolve()
        if not local.is_relative_to(folder.resolve()):
            message = f"The copy of {path!r} is outside the folder it was fetched into."
            raise PluginCallFailedError(kind="plugin", message=message, plugin=None, key=root.kind)
        yield local
    finally:
        shutil.rmtree(folder, ignore_errors=True)


def _require_within(size: int, limit: int) -> None:
    if size > limit:
        raise FileTooLargeError(size, limit)
