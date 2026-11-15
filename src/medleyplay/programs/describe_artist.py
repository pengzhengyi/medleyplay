"""The program that asks an AI model which name to show an artist by, and who it is."""

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from medleyplay.plugin_api import (
    DESCRIBE_ARTIST,
    MAX_ABOUT_SUGGESTED,
    MAX_NAME,
    MAX_NAMES_OFFERED,
    MAX_SONGS_SHOWN,
    ArtistOption,
    DescribeArtist,
    FindStatus,
)
from medleyplay.plugin_host.job import AnswerFailedError, JobContext, JobProgram

type _Name = Annotated[str, StringConstraints(min_length=1, max_length=MAX_NAME)]


class _Model(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class DescribeArtistJob(_Model):
    """Ask `describer` which of `names` to show `artist` by, and who it is."""

    artist: ArtistOption
    names: Annotated[tuple[_Name, ...], Field(min_length=1, max_length=MAX_NAMES_OFFERED)]
    songs: Annotated[tuple[_Name, ...], Field(max_length=MAX_SONGS_SHOWN)] = ()
    describer: Annotated[str, StringConstraints(max_length=64)] = "ai-details"


class DescribedArtistResult(_Model):
    """The name suggested of those offered, why, a note, and the provider that answered."""

    offered: Annotated[tuple[_Name, ...], Field(max_length=MAX_NAMES_OFFERED)]
    shown_as: _Name | None = None
    why: Annotated[str, StringConstraints(max_length=300)] = ""
    about: Annotated[str, StringConstraints(max_length=MAX_ABOUT_SUGGESTED)] = ""
    ai_answered: Annotated[str, StringConstraints(max_length=64)] = ""


def run(request: DescribeArtistJob, context: JobContext) -> DescribedArtistResult:
    """Ask the describer with the providers the Job is lent, and fail if it suggests nothing.

    A name it suggests that was not offered is no suggestion.
    """
    asking = DescribeArtist(
        artist=request.artist, names=request.names, songs=request.songs, ai=context.ai
    )
    answer = context.call(DESCRIBE_ARTIST, request.describer, asking)
    if answer.status is FindStatus.REFUSED:
        message = answer.message or "The AI provider refused the request."
        raise AnswerFailedError(message, kind="refused")
    shown_as = answer.shown_as if answer.shown_as in request.names else None
    if shown_as is None and not answer.about:
        message = answer.message or "The AI model's answer suggested neither a name nor a note."
        raise AnswerFailedError(message, kind="invalid")
    return DescribedArtistResult(
        offered=request.names,
        shown_as=shown_as,
        why=answer.why if shown_as is not None else "",
        about=answer.about,
        ai_answered=answer.ai_answered,
    )


DESCRIBE_ARTIST_PROGRAM: JobProgram[DescribeArtistJob, DescribedArtistResult] = JobProgram(
    DescribeArtistJob, DescribedArtistResult, run
)
