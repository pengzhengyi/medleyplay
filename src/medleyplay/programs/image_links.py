"""The programs that ask an AI model for links to a picture, and fetch one approved.

The fetcher writes the image into `images/`, a folder of its own, and the program
copies it as an enricher's cover is copied, so the result holds no image bytes.
"""

from typing import Annotated, Final

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from medleyplay.plugin_api import (
    FETCH_IMAGE,
    MAX_HINT,
    MAX_IMAGE_LINKS,
    MAX_NAME,
    MAX_SONGS_SHOWN,
    SUGGEST_IMAGES,
    FetchImage,
    FindStatus,
    ImageLink,
    ImageSubject,
    ImageUrl,
    SuggestImages,
)
from medleyplay.plugin_host.job import AnswerFailedError, JobContext, JobProgram
from medleyplay.programs.scan_covers import CoverFile, copy_written

IMAGES_FOLDER: Final = "images"
"""Where the fetcher writes the image, in the Job's working folder."""

type _Name = Annotated[str, StringConstraints(min_length=1, max_length=MAX_NAME)]
type _Artist = Annotated[str, StringConstraints(max_length=MAX_NAME)]
type _Key = Annotated[str, StringConstraints(max_length=64)]


class _Model(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class SuggestImagesJob(_Model):
    """Ask `suggester` for links to a picture of `name`, an album by `artist`, or an artist.

    `hint` is what the listener wrote for the AI, or empty.
    """

    subject: ImageSubject
    name: _Name
    artist: _Artist = ""
    songs: Annotated[tuple[_Name, ...], Field(max_length=MAX_SONGS_SHOWN)] = ()
    hint: Annotated[str, StringConstraints(max_length=MAX_HINT)] = Field(default="", repr=False)
    suggester: _Key = "ai-details"


class SuggestedImagesResult(_Model):
    """The links to a picture of `name` by `artist` suggested, best first, and who answered."""

    name: str
    artist: str
    links: Annotated[tuple[ImageLink, ...], Field(max_length=MAX_IMAGE_LINKS)] = ()
    ai_answered: _Key = ""


def run_suggest(request: SuggestImagesJob, context: JobContext) -> SuggestedImagesResult:
    """Ask the suggester with the providers the Job is lent, and fail if the provider refuses."""
    asking = SuggestImages(
        subject=request.subject,
        name=request.name,
        artist=request.artist,
        songs=request.songs,
        hint=request.hint,
        ai=context.ai,
    )
    answer = context.call(SUGGEST_IMAGES, request.suggester, asking)
    if answer.status is FindStatus.REFUSED:
        message = answer.message or "The AI provider refused the request."
        raise AnswerFailedError(message, kind="refused")
    return SuggestedImagesResult(
        name=request.name,
        artist=request.artist,
        links=answer.links,
        ai_answered=answer.ai_answered,
    )


SUGGEST_IMAGES_PROGRAM: JobProgram[SuggestImagesJob, SuggestedImagesResult] = JobProgram(
    SuggestImagesJob, SuggestedImagesResult, run_suggest
)


class FetchImageJob(_Model):
    """Ask `fetcher` for the image at `url`, a link suggested and approved."""

    url: ImageUrl
    fetcher: _Key = "ai-details"


class FetchedImageResult(_Model):
    """A copy of the image at `url`, or why there is none there to fetch."""

    url: str
    cover: CoverFile | None = None
    unavailable: Annotated[str, StringConstraints(max_length=500)] = ""


def run_fetch(request: FetchImageJob, context: JobContext) -> FetchedImageResult:
    """Ask the fetcher; an image that is no plain image directly in the folder is none."""
    folder = context.work_dir / IMAGES_FOLDER
    folder.mkdir(exist_ok=True)
    answer = context.call(
        FETCH_IMAGE, request.fetcher, FetchImage(url=request.url, folder=str(folder))
    )
    if not answer.file:
        return FetchedImageResult(
            url=request.url, unavailable=answer.message or "There is no image there."
        )
    copy = copy_written(folder, answer.file, context.work_dir)
    if copy is None:
        message = "The link is not an image: not a JPEG, PNG, or WebP image."
        return FetchedImageResult(url=request.url, unavailable=message)
    return FetchedImageResult(url=request.url, cover=copy)


FETCH_IMAGE_PROGRAM: JobProgram[FetchImageJob, FetchedImageResult] = JobProgram(
    FetchImageJob, FetchedImageResult, run_fetch
)
