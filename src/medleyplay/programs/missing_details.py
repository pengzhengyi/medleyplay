"""Run one missing-details request without invoking ordinary enrichment."""

from typing import Literal

from pydantic import BaseModel, ConfigDict

from medleyplay.plugin_api.missing_details import (
    SUGGEST_MISSING_DETAILS,
    CreditClues,
    SuggestedMissingDetails,
    SuggestMissingDetails,
)
from medleyplay.plugin_host.job import AnswerFailedError, JobContext, JobProgram


class MissingDetailsJob(BaseModel):
    """Ask about a Track at the revision of its details that was reviewed."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    track_id: int
    key: str
    clues: CreditClues
    lane: Literal["ai-details"] = "ai-details"


def run(request: MissingDetailsJob, context: JobContext) -> SuggestedMissingDetails:
    """Return only candidates for the requested fields."""
    answer = context.call(
        SUGGEST_MISSING_DETAILS,
        "ai-details",
        SuggestMissingDetails(clues=request.clues, ai=context.ai),
    )
    if answer.status == "refused":
        raise AnswerFailedError(
            answer.message or "The AI provider refused the request.", kind="refused"
        )
    if answer.status != "ok" or not answer.values.keys() <= set(request.clues.missing):
        message = answer.message or "The AI did not return usable missing details."
        raise AnswerFailedError(message, kind="invalid")
    return answer


MISSING_DETAILS_PROGRAM = JobProgram(MissingDetailsJob, SuggestedMissingDetails, run)
