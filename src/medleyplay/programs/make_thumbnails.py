"""The program that asks a thumbnailer for the thumbnails of kept images.

Each image's thumbnails are written into the Job's working folder; the server moves
them into place once the Job ends. An image is read as the kind its first bytes say,
and one that is no cover image is unreadable without asking.
"""

from pathlib import Path
from typing import Annotated, Final

from pydantic import BaseModel, ConfigDict, Field

from medleyplay.plugin_api import (
    MAKE_THUMBNAILS,
    MAX_THUMBNAIL_SIZES,
    CoverName,
    MakeThumbnails,
    ThumbnailSize,
    ThumbnailStatus,
    image_kind,
)
from medleyplay.plugin_host.job import JobContext, JobProgram

MAX_BATCH: Final = 500
"""The most images one Job thumbnails."""
_HEAD: Final = 12
"""How many first bytes say an image's kind."""


class _Model(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class MakeThumbnailsJob(_Model):
    """Ask `thumbnailer` for the thumbnails at `sizes` of the images `names` in `covers_folder`."""

    covers_folder: str
    names: Annotated[tuple[CoverName, ...], Field(min_length=1, max_length=MAX_BATCH)]
    sizes: Annotated[tuple[ThumbnailSize, ...], Field(min_length=1, max_length=MAX_THUMBNAIL_SIZES)]
    quality: Annotated[int, Field(ge=2, le=31)]
    thumbnailer: Annotated[str, Field(max_length=64)] = "ffmpeg-thumbnails"


class Thumbnailed(_Model):
    """How the thumbnailer answered for the image `name`, and the sizes it made."""

    name: CoverName
    status: ThumbnailStatus
    made: Annotated[tuple[str, ...], Field(max_length=MAX_THUMBNAIL_SIZES)] = ()


class MadeThumbnailsResult(_Model):
    """Each image asked about that is still kept, in the order asked."""

    images: Annotated[tuple[Thumbnailed, ...], Field(max_length=MAX_BATCH)] = ()


def run(request: MakeThumbnailsJob, context: JobContext) -> MadeThumbnailsResult:
    """Thumbnail each image, stopping when the thumbnailer has no program to run."""
    images: list[Thumbnailed] = []
    for done, name in enumerate(request.names, start=1):
        source = Path(request.covers_folder) / name
        try:
            with source.open("rb") as file:
                kind = image_kind(file.read(_HEAD))
        except OSError:
            kind = None
            if not source.exists():
                continue
        if kind is None:
            images.append(Thumbnailed(name=name, status=ThumbnailStatus.UNREADABLE))
        else:
            made = context.call(
                MAKE_THUMBNAILS,
                request.thumbnailer,
                MakeThumbnails(
                    source_path=str(source),
                    kind=kind,
                    name=name,
                    folder=str(context.work_dir),
                    sizes=request.sizes,
                    quality=request.quality,
                ),
            )
            images.append(Thumbnailed(name=name, status=made.status, made=made.made))
            if made.status is ThumbnailStatus.NO_TOOL:
                break
        context.report(done / len(request.names), f"{done} of {len(request.names)} images")
    return MadeThumbnailsResult(images=tuple(images))


MAKE_THUMBNAILS_PROGRAM: JobProgram[MakeThumbnailsJob, MadeThumbnailsResult] = JobProgram(
    MakeThumbnailsJob, MadeThumbnailsResult, run
)
