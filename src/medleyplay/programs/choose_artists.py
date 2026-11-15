"""The program that asks an AI model which of the artists offered each name names."""

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from medleyplay.plugin_api import (
    CHOOSE_ARTISTS,
    MAX_ARTISTS,
    MAX_CHOICES,
    ChooseArtists,
    ChosenArtist,
    FindStatus,
    NameToChoose,
)
from medleyplay.plugin_host.job import AnswerFailedError, JobContext, JobProgram


class _Model(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class ChooseArtistsJob(_Model):
    """Ask `chooser` which of its options each of `names` names."""

    names: Annotated[tuple[NameToChoose, ...], Field(min_length=1, max_length=MAX_CHOICES)]
    chooser: Annotated[str, StringConstraints(max_length=64)] = "ai-details"


class OfferedArtists(_Model):
    """The ids of the artists a name was offered."""

    name: Annotated[str, StringConstraints(max_length=512)]
    artist_ids: Annotated[
        tuple[Annotated[str, StringConstraints(max_length=64)], ...],
        Field(max_length=MAX_ARTISTS),
    ] = ()


class ChosenArtistsResult(_Model):
    """The choice for each name answered for, what each was offered, and who answered."""

    chosen: Annotated[tuple[ChosenArtist, ...], Field(max_length=MAX_CHOICES)] = ()
    offered: Annotated[tuple[OfferedArtists, ...], Field(max_length=MAX_CHOICES)] = ()
    ai_answered: Annotated[str, StringConstraints(max_length=64)] = ""


def run(request: ChooseArtistsJob, context: JobContext) -> ChosenArtistsResult:
    """Ask the chooser with the providers the Job is lent, and fail if none answers."""
    answer = context.call(
        CHOOSE_ARTISTS, request.chooser, ChooseArtists(names=request.names, ai=context.ai)
    )
    if answer.status is FindStatus.REFUSED:
        message = answer.message or "The AI provider refused the request."
        raise AnswerFailedError(message, kind="refused")
    if not answer.chosen:
        message = answer.message or "The AI model's answer chose for none of the names."
        raise AnswerFailedError(message, kind="invalid")
    chosen = {each.name for each in answer.chosen}
    offered = tuple(
        OfferedArtists(name=each.name, artist_ids=tuple(option.id for option in each.options))
        for each in request.names
        if each.name in chosen
    )
    return ChosenArtistsResult(
        chosen=answer.chosen, offered=offered, ai_answered=answer.ai_answered
    )


CHOOSE_ARTISTS_PROGRAM: JobProgram[ChooseArtistsJob, ChosenArtistsResult] = JobProgram(
    ChooseArtistsJob, ChosenArtistsResult, run
)
