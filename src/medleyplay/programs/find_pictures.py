"""The program that finds pictures of an artist on a site.

The picture finder writes each picture into `pictures/`, a folder of its own, and the
program copies each as an enricher's cover is copied, so the result holds no image bytes.
"""

from typing import Annotated, Final

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from medleyplay.plugin_api import (
    FIND_PICTURES,
    MAX_NAME,
    MAX_PICTURES,
    FindPictures,
    FindStatus,
)
from medleyplay.plugin_host.job import AnswerFailedError, JobContext, JobProgram
from medleyplay.programs.scan_covers import CoverFile, copy_written

PICTURES_FOLDER: Final = "pictures"
"""Where the picture finder writes the pictures, in the Job's working folder."""


class _Model(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class FindPicturesJob(_Model):
    """Ask `finder` for pictures of the artists going by `name`, for the artist `artist_id`."""

    artist_id: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    name: Annotated[str, StringConstraints(min_length=1, max_length=MAX_NAME)]
    finder: Annotated[str, StringConstraints(max_length=64)] = "deezer"


class FoundPictureCopy(_Model):
    """A picture of an artist the site knows by `name`, `fans` following it, and its copy."""

    name: Annotated[str, StringConstraints(max_length=MAX_NAME)]
    fans: Annotated[int, Field(ge=0)] | None = None
    picture: CoverFile


class FoundPicturesResult(_Model):
    """The pictures the finder found for the artist `artist_id`, the most followed first."""

    artist_id: str
    finder: str
    pictures: Annotated[tuple[FoundPictureCopy, ...], Field(max_length=MAX_PICTURES)] = ()


def run(request: FindPicturesJob, context: JobContext) -> FoundPicturesResult:
    """Ask the finder, and fail the Job if the site refuses.

    A picture that is no plain image directly in the folder is left out.
    """
    folder = context.work_dir / PICTURES_FOLDER
    folder.mkdir(exist_ok=True)
    answer = context.call(
        FIND_PICTURES, request.finder, FindPictures(artist=request.name, folder=str(folder))
    )
    if answer.status is FindStatus.REFUSED:
        message = answer.message or "The site refused the request."
        raise AnswerFailedError(message, kind="refused")
    copies = [
        FoundPictureCopy(name=found.name, fans=found.fans, picture=copy)
        for found in answer.pictures
        if (copy := copy_written(folder, found.file, context.work_dir)) is not None
    ]
    return FoundPicturesResult(
        artist_id=request.artist_id, finder=request.finder, pictures=tuple(copies)
    )


FIND_PICTURES_PROGRAM: JobProgram[FindPicturesJob, FoundPicturesResult] = JobProgram(
    FindPicturesJob, FoundPicturesResult, run
)
