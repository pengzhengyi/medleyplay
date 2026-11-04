"""The covers a scan finds: an image beside a file, and a cover embedded in its tags.

Each image is copied into the Job's working folder as it is read, under the SHA-256
of its bytes, and the scan reports the copy's path, so the result never holds image
bytes and the songs of an album share one copy:

```text
Music/Blue/01 Intro.m4a      the file
Music/Blue/01 Intro.jpg      the image beside it
<work>/covers/9f2c...        the copy the scan reports
```
"""

import base64
import binascii
import hashlib
from collections.abc import Iterable
from pathlib import Path
from typing import Final

from pydantic import BaseModel, ConfigDict

from medleyplay.plugin_api import MAX_COVER_BYTES, LibraryFile, LibraryRoot, Tags, is_cover_image
from medleyplay.plugin_host.job import JobContext, PluginCallFailedError
from medleyplay.programs.library_files import (
    FileGoneError,
    FileTooLargeError,
    extension_of,
    name_of,
    read_whole,
)

COVER_EXTENSIONS: Final = ("jpg", "jpeg", "png", "webp")
"""The extensions of an image beside a file, in the order the first one found is the cover."""
COPIES_FOLDER: Final = "covers"
"""Where the Job keeps its copies of the images it reads, in its working folder."""


class _Model(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class ImageStamp(_Model):
    """The extension, size, and modified time of the image beside a file, which tell it changed."""

    extension: str
    size: int
    modified_ns: int


class CoverFile(_Model):
    """A copy of a cover in the Job's working folder: the cover's name, and the copy's path."""

    name: str
    path: str


class CoverImage(_Model):
    """The image beside a file: its stamp, and what reading it gave.

    An image the scan skipped as unchanged has neither `cover` nor `error`. One it
    read has the `cover`, or the `error` when it isn't a cover; `retry` says the
    error may pass, as when its drive answered too late, so the next scan reads it
    again.
    """

    extension: str
    size: int
    modified_ns: int
    cover: CoverFile | None = None
    error: str = ""
    retry: bool = False


class CopyFolder:
    """The Job's copies of the images it reads, each kept once under the name of its bytes."""

    def __init__(self, folder: Path) -> None:
        """Keep copies in `folder`, which is made when the first one is."""
        self._folder = folder

    def keep(self, data: bytes) -> CoverFile:
        """Copy the image `data` into the folder, unless its copy is there; return the copy."""
        name = hashlib.sha256(data).hexdigest()
        path = self._folder / name
        if not (path.is_file() and path.stat().st_size == len(data)):
            self._folder.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        return CoverFile(name=name, path=str(path))


def images_beside(files: Iterable[LibraryFile], names: set[str]) -> dict[str, LibraryFile]:
    """Return the image beside each of the named files that has one, keyed by the name.

    `Blue/a.JPG` is beside `Blue/a.m4a`, whose name is `Blue/a`. When a file has
    more than one, the first by `COVER_EXTENSIONS` is its image.
    """
    found: dict[str, LibraryFile] = {}
    for file in files:
        name = name_of(file.path)
        extension = extension_of(file.path)
        if name not in names or extension not in COVER_EXTENSIONS:
            continue
        better = name not in found or _rank(extension) < _rank(extension_of(found[name].path))
        if better:
            found[name] = file
    return found


def read_image(
    root: LibraryRoot,
    image: LibraryFile,
    known: ImageStamp | None,
    copies: CopyFolder,
    context: JobContext,
    *,
    full: bool,
) -> CoverImage:
    """Report the image beside a file, reading it when it is new, changed, or the scan is full."""
    extension = extension_of(image.path)
    stamp = ImageStamp(extension=extension, size=image.size, modified_ns=image.modified_ns)
    listed = CoverImage(extension=extension, size=image.size, modified_ns=image.modified_ns)
    if known == stamp and not full:
        return listed
    try:
        data = read_whole(root, image, context, MAX_COVER_BYTES)
        if not is_cover_image(data):
            return listed.model_copy(update={"error": "isn't a JPEG, PNG, or WebP image"})
        return listed.model_copy(update={"cover": copies.keep(data)})
    except FileTooLargeError as error:
        return listed.model_copy(update={"error": f"is too large ({error})"})
    except FileGoneError:
        return listed.model_copy(update={"error": "is gone"})
    except (PluginCallFailedError, OSError) as error:
        failed = f"can't be read ({type(error).__name__})"
        return listed.model_copy(update={"error": failed, "retry": True})


def detach_cover(tags: Tags, copies: CopyFolder) -> tuple[Tags, CoverFile | None]:
    """Move the cover out of `tags` into a copy; return the tags without it, and the copy.

    A cover that isn't valid base64, isn't a JPEG, PNG, or WebP image, or is over the
    limit is no cover, whatever the tag reader said.
    """
    if tags.cover is None:
        return tags, None
    bare = tags.model_copy(update={"cover": None})
    try:
        data = base64.b64decode(tags.cover, validate=True)
    except binascii.Error:
        return bare, None
    if len(data) > MAX_COVER_BYTES or not is_cover_image(data):
        return bare, None
    try:
        return bare, copies.keep(data)
    except OSError:
        return bare, None


def _rank(extension: str) -> int:
    return COVER_EXTENSIONS.index(extension)
