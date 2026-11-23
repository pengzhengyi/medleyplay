"""The programs that find the songs the lyrics sites have, and ask a model which is the song.

The songs are found by a title and artist. What the finder answers is the result,
lyrics and all: nothing is written to disk.
"""

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from medleyplay.plugin_api import (
    CHOOSE_LYRICS,
    FIND_LYRICS,
    MAX_LYRICS_FOUND,
    MAX_NAME,
    ChooseLyrics,
    FindLyrics,
    FindStatus,
    LyricsChoice,
    LyricsOption,
    LyricsProvider,
)
from medleyplay.plugin_host.job import AnswerFailedError, JobContext, JobProgram

type _Name = Annotated[str, StringConstraints(min_length=1, max_length=MAX_NAME)]
type _Artist = Annotated[str, StringConstraints(max_length=MAX_NAME)]


class _Model(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class MatchSong(_Model):
    """The saved segment an album search is for, as it was when requested."""

    segment_id: Annotated[int, Field(ge=1)]
    start_ms: Annotated[int, Field(ge=0)]
    title: _Name
    artist: _Artist


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
    match: MatchSong | None = None


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


class ChooseLyricsJob(_Model):
    """Ask `chooser` which of `options` is the song `title` by `artist`, for the Track `track_id`.

    `offered` names each option, in the same order, so the answer can be matched to the
    songs found when it comes back.
    """

    track_id: Annotated[int, Field(ge=1)]
    title: _Name
    artist: _Artist = ""
    album: _Artist = ""
    duration_ms: Annotated[int, Field(ge=0)] | None = None
    options: Annotated[tuple[LyricsChoice, ...], Field(min_length=1, max_length=MAX_LYRICS_FOUND)]
    offered: Annotated[tuple[str, ...], Field(max_length=MAX_LYRICS_FOUND)]
    chooser: Annotated[str, StringConstraints(max_length=64)] = "ai-details"
    search_job: int | None = None


class ChosenLyricsResult(_Model):
    """The option the model chose of those `offered`, by its place, or none, and why."""

    track_id: int
    offered: tuple[str, ...]
    option: int | None = None
    why: str = ""
    ai_answered: str = ""


def run_choice(request: ChooseLyricsJob, context: JobContext) -> ChosenLyricsResult:
    """Ask the chooser with the providers the Job is lent, and fail if every one refuses."""
    answer = context.call(
        CHOOSE_LYRICS,
        request.chooser,
        ChooseLyrics(
            title=request.title,
            artist=request.artist,
            album=request.album,
            duration_ms=request.duration_ms,
            options=request.options,
            ai=context.ai,
        ),
    )
    if answer.status is FindStatus.REFUSED:
        message = answer.message or "The AI provider refused the request."
        raise AnswerFailedError(message, kind="refused")
    chosen = (
        answer.option
        if answer.option is not None and answer.option < len(request.options)
        else None
    )
    return ChosenLyricsResult(
        track_id=request.track_id,
        offered=request.offered,
        option=chosen,
        why=answer.why if chosen is not None else "",
        ai_answered=answer.ai_answered,
    )


CHOOSE_LYRICS_PROGRAM: JobProgram[ChooseLyricsJob, ChosenLyricsResult] = JobProgram(
    ChooseLyricsJob, ChosenLyricsResult, run_choice
)
