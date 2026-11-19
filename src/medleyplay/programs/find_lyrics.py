"""The program that finds the songs the lyrics sites have of a title and artist.

What the finder answers is the result, lyrics and all: nothing is written to disk.
"""

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from medleyplay.plugin_api import (
    FIND_LYRICS,
    MAX_LYRICS_FOUND,
    MAX_NAME,
    FindLyrics,
    FindStatus,
    LyricsOption,
    LyricsProvider,
)
from medleyplay.plugin_host.job import AnswerFailedError, JobContext, JobProgram

type _Name = Annotated[str, StringConstraints(min_length=1, max_length=MAX_NAME)]
type _Artist = Annotated[str, StringConstraints(max_length=MAX_NAME)]


class _Model(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class FindLyricsJob(_Model):
    """Ask `finder` for the songs titled `title` by `artist`, for the Track `track_id`.

    `duration_ms` is the Track's length, when known; `sites` the sites besides LRCLIB
    the household turned on.
    """

    track_id: Annotated[int, Field(ge=1)]
    title: _Name
    artist: _Artist = ""
    duration_ms: Annotated[int, Field(ge=0)] | None = None
    sites: tuple[LyricsProvider, ...] = ()
    finder: Annotated[str, StringConstraints(max_length=64)] = "lyrics"


class FoundLyricsResult(_Model):
    """The songs found for the Track, with their lyrics, the closest first."""

    track_id: int
    title: str
    artist: str
    options: Annotated[tuple[LyricsOption, ...], Field(max_length=MAX_LYRICS_FOUND)] = ()


def run(request: FindLyricsJob, context: JobContext) -> FoundLyricsResult:
    """Ask the finder, and fail the Job if a site refuses and nothing was found."""
    answer = context.call(
        FIND_LYRICS,
        request.finder,
        FindLyrics(
            title=request.title,
            artist=request.artist,
            duration_ms=request.duration_ms,
            sites=request.sites,
        ),
    )
    if answer.status is FindStatus.REFUSED:
        message = answer.message or "The site refused the request."
        raise AnswerFailedError(message, kind="refused")
    return FoundLyricsResult(
        track_id=request.track_id,
        title=request.title,
        artist=request.artist,
        options=answer.options,
    )


FIND_LYRICS_PROGRAM: JobProgram[FindLyricsJob, FoundLyricsResult] = JobProgram(
    FindLyricsJob, FoundLyricsResult, run
)
