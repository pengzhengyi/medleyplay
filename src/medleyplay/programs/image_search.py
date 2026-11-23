"""Run one explicitly requested picture search in the dedicated provider's process."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, SecretStr

from medleyplay.plugin_api.artists import FindStatus
from medleyplay.plugin_api.image_search import (
    SEARCH_PICTURES,
    TAVILY,
    PictureName,
    PictureResults,
    SearchPictures,
)
from medleyplay.plugin_host.job import AnswerFailedError, JobContext, JobProgram


class PictureSearchJob(BaseModel):
    """The search target and its lane; the credential is never part of the request."""

    model_config = ConfigDict(frozen=True, extra="forbid")
    album: PictureName
    artist: PictureName
    provider: Literal["tavily"] = "tavily"


def run(request: PictureSearchJob, context: JobContext) -> PictureResults:
    """Ask only Tavily, using the key lent at dispatch rather than at submission."""
    if not context.tavily_key:
        message = "Enable the Tavily plugin and set its key in Settings."
        raise AnswerFailedError(message, kind="refused")
    answer = context.call(
        SEARCH_PICTURES,
        TAVILY,
        SearchPictures(
            album=request.album, artist=request.artist, key=SecretStr(context.tavily_key)
        ),
    )
    if answer.status is FindStatus.REFUSED:
        message = "Tavily refused the search. Check the key and its quota."
        raise AnswerFailedError(message, kind="refused")
    return answer


SEARCH: JobProgram[PictureSearchJob, PictureResults] = JobProgram(
    PictureSearchJob, PictureResults, run
)
