"""The programs that find pictures of an artist on a site, and ask which is of the artist.

The picture finder writes each picture into `pictures/`, a folder of its own, and the
program copies each as an enricher's cover is copied, so the result holds no image bytes.
The picture chooser is shown each picture's artist by name and following, never the
picture, and answers one by its place, which the program turns back into its cover.
"""

from typing import Annotated, Final

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from medleyplay.plugin_api import (
    CHOOSE_PICTURE,
    FIND_PICTURES,
    MAX_HINT,
    MAX_NAME,
    MAX_OTHER_NAMES,
    MAX_PICTURES,
    MAX_SONGS_SHOWN,
    ChoosePicture,
    FindPictures,
    FindStatus,
    PictureOption,
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


type _Name = Annotated[str, StringConstraints(min_length=1, max_length=MAX_NAME)]
type _Cover = Annotated[str, StringConstraints(min_length=1, max_length=128)]


class ChoosePictureJob(_Model):
    """Ask `chooser` which of `options` is a picture of the artist `artist_id`, named `artist`.

    `covers` hold the pictures offered, in the order of `options`.
    """

    artist_id: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    artist: _Name
    other_names: Annotated[tuple[_Name, ...], Field(max_length=MAX_OTHER_NAMES)] = ()
    about: Annotated[str, StringConstraints(max_length=MAX_NAME)] = ""
    songs: Annotated[tuple[_Name, ...], Field(max_length=MAX_SONGS_SHOWN)] = ()
    hint: Annotated[str, StringConstraints(max_length=MAX_HINT)] = ""
    options: Annotated[tuple[PictureOption, ...], Field(min_length=1, max_length=MAX_PICTURES)]
    covers: Annotated[tuple[_Cover, ...], Field(min_length=1, max_length=MAX_PICTURES)]
    chooser: Annotated[str, StringConstraints(max_length=64)] = "ai-details"


class ChosenPictureResult(_Model):
    """The picture chosen of those offered, by its cover, or none, why, and who answered."""

    artist_id: str
    offered: Annotated[tuple[_Cover, ...], Field(max_length=MAX_PICTURES)]
    cover: _Cover | None = None
    why: Annotated[str, StringConstraints(max_length=300)] = ""
    hint: Annotated[str, StringConstraints(max_length=MAX_HINT)] = ""
    ai_answered: Annotated[str, StringConstraints(max_length=64)] = ""


def run_choice(request: ChoosePictureJob, context: JobContext) -> ChosenPictureResult:
    """Ask the chooser with the providers the Job is lent, and fail if the provider refuses.

    A place past the pictures offered is no choice.
    """
    asking = ChoosePicture(
        artist=request.artist,
        other_names=request.other_names,
        about=request.about,
        songs=request.songs,
        hint=request.hint,
        options=request.options,
        ai=context.ai,
    )
    answer = context.call(CHOOSE_PICTURE, request.chooser, asking)
    if answer.status is FindStatus.REFUSED:
        message = answer.message or "The AI provider refused the request."
        raise AnswerFailedError(message, kind="refused")
    at = answer.option
    cover = request.covers[at] if at is not None and at < len(request.covers) else None
    return ChosenPictureResult(
        artist_id=request.artist_id,
        offered=request.covers,
        cover=cover,
        why=answer.why if cover is not None else "",
        hint=request.hint,
        ai_answered=answer.ai_answered,
    )


CHOOSE_PICTURE_PROGRAM: JobProgram[ChoosePictureJob, ChosenPictureResult] = JobProgram(
    ChoosePictureJob, ChosenPictureResult, run_choice
)
