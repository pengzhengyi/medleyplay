"""What a cover image is, and the thumbnailer that makes small copies of one.

A cover is a JPEG, PNG, or WebP image of at most 10 MiB, known by its first bytes,
not by the name of its file: bytes that begin `GIF89a` are no cover.

Asked with a kept image, a thumbnailer writes a smaller copy for each size the image
is larger than:

```text
ask      covers/3f9a…, a PNG; sizes small 128 px and medium 512 px, into jobs/41/
answer   ok, made small and medium: jobs/41/3f9a…-small, jobs/41/3f9a…-medium
```
"""

from datetime import timedelta
from enum import StrEnum
from typing import Annotated, Final, Protocol

from pydantic import BaseModel, ConfigDict, Field

from medleyplay.plugin_api.extension import ExtensionPoint

MAX_COVER_BYTES: Final = 10 * 1024 * 1024
"""An image longer than this is not a cover."""
MAX_THUMBNAIL_SIZES: Final = 4
"""The most sizes one image is thumbnailed at."""

type CoverName = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
"""A kept image's name: the SHA-256 of its bytes, in hex."""
type SizeLabel = Annotated[str, Field(pattern=r"^[a-z]{1,16}$")]
"""What a thumbnail size is called, such as `small`; it ends the thumbnail's file name."""


class _Model(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class ImageKind(StrEnum):
    """The kinds of image a cover may be, by media type."""

    JPEG = "image/jpeg"
    PNG = "image/png"
    WEBP = "image/webp"


def image_kind(data: bytes) -> ImageKind | None:
    """Return the kind of image `data` begins as, or `None` for anything else."""
    if data.startswith(b"\xff\xd8\xff"):
        return ImageKind.JPEG
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ImageKind.PNG
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ImageKind.WEBP
    return None


def is_cover_image(data: bytes) -> bool:
    """Return whether `data` begins as a JPEG, PNG, or WebP image."""
    return image_kind(data) is not None


class ThumbnailSize(_Model):
    """A size to thumbnail at: the image's shorter side becomes `pixels` long."""

    label: SizeLabel
    pixels: Annotated[int, Field(ge=16, le=4096)]


class MakeThumbnails(_Model):
    """Write a thumbnail of the image `source_path`, a `kind`, for each size it is larger than.

    Each goes to `folder`, named `<name>-<label>`, as a JPEG at `quality` on ffmpeg's
    `-q:v` scale (2 is best), or as a PNG when the image has transparency.
    """

    source_path: str
    kind: ImageKind
    name: CoverName
    folder: str
    sizes: Annotated[tuple[ThumbnailSize, ...], Field(min_length=1, max_length=MAX_THUMBNAIL_SIZES)]
    quality: Annotated[int, Field(ge=2, le=31)]


class ThumbnailStatus(StrEnum):
    """How the thumbnailer answered."""

    OK = "ok"
    NO_TOOL = "no_tool"
    """The program the thumbnailer runs isn't installed."""
    UNREADABLE = "unreadable"
    """The program couldn't read the file as an image, or the image is too large."""
    TIMED_OUT = "timed_out"
    """The program took too long, which a busy machine may cause; asking again may do."""


class MadeThumbnails(_Model):
    """The labels of the sizes written; none when the image is no larger than any size."""

    status: ThumbnailStatus = ThumbnailStatus.OK
    made: Annotated[tuple[SizeLabel, ...], Field(max_length=MAX_THUMBNAIL_SIZES)] = ()


class Thumbnailer(Protocol):
    """Makes smaller copies of a kept image."""

    def make_thumbnails(self, request: MakeThumbnails) -> MadeThumbnails:
        """Write the image's thumbnails."""
        ...


THUMBNAILER = ExtensionPoint[Thumbnailer]("thumbnailer")
MAKE_THUMBNAILS = THUMBNAILER.operation(
    "make_thumbnails",
    MakeThumbnails,
    MadeThumbnails,
    lambda thumbnailer: thumbnailer.make_thumbnails,
    deadline=timedelta(seconds=60),
)
