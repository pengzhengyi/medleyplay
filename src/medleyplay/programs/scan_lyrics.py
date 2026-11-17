"""The `.lrc` beside an audio file, named as it is: found by a scan, and read when it changed.

The text is read as UTF-8, with or without a byte order mark, as UTF-16 with one, and
otherwise as GB18030, which many Chinese `.lrc` files are written in.
"""

import codecs
from collections.abc import Iterable
from typing import Final

from pydantic import BaseModel, ConfigDict

from medleyplay.plugin_api import MAX_LYRICS, LibraryFile, LibraryRoot
from medleyplay.plugin_host.job import JobContext, PluginCallFailedError
from medleyplay.programs.library_files import (
    FileGoneError,
    FileTooLargeError,
    extension_of,
    name_of,
    read_whole,
)

LRC_EXTENSION: Final = "lrc"
MAX_BYTES: Final = MAX_LYRICS * 4
"""The most bytes read: `MAX_LYRICS` characters of UTF-8 at four bytes each."""


class LyricsFile(BaseModel):
    """The `.lrc` beside a file: its stamp, and what reading it gave.

    One the scan skipped as unchanged has neither `text` nor `error`. One it read has
    the `text`, or the `error` when it isn't lyrics; `retry` says the error may pass, as
    when its drive answered too late, so the next scan reads it again.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    size: int
    modified_ns: int
    text: str | None = None
    error: str = ""
    retry: bool = False


def lyrics_beside(files: Iterable[LibraryFile], names: set[str]) -> dict[str, LibraryFile]:
    """Return the `.lrc` beside each of the named files that has one, keyed by the name.

    `Blue/a.LRC` is beside `Blue/a.m4a`, whose name is `Blue/a`.
    """
    return {
        name_of(file.path): file
        for file in files
        if extension_of(file.path) == LRC_EXTENSION and name_of(file.path) in names
    }


def read_lyrics(
    root: LibraryRoot, file: LibraryFile, context: JobContext, *, unchanged: bool
) -> LyricsFile:
    """Report the `.lrc`, reading it unless it is `unchanged` since the last scan."""
    listed = LyricsFile(size=file.size, modified_ns=file.modified_ns)
    if unchanged:
        return listed
    text, error, retry = _read(root, file, context)
    return listed.model_copy(update={"text": text, "error": error, "retry": retry})


def _read(
    root: LibraryRoot, file: LibraryFile, context: JobContext
) -> tuple[str | None, str, bool]:
    """Return the file's text, or why it isn't lyrics and whether reading it again may help."""
    try:
        data = read_whole(root, file, context, MAX_BYTES)
    except FileGoneError:
        return None, "is gone", False
    except FileTooLargeError:
        return None, "is too long", False
    except (PluginCallFailedError, OSError) as error:
        return None, f"can't be read ({type(error).__name__})", True
    text = _decoded(data)
    if text is None:
        return None, "isn't text", False
    if len(text) > MAX_LYRICS:
        return None, "is too long", False
    return text, "", False


def _decoded(data: bytes) -> str | None:
    """Return the bytes as text in the first encoding that reads them all, or `None`."""
    if data.startswith((codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE)):
        encodings: tuple[str, ...] = ("utf-16",)
    else:
        encodings = ("utf-8-sig", "gb18030")
    for encoding in encodings:
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return None
