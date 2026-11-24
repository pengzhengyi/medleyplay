"""The Clean up API for suggesting or intentionally leaving missing details."""

from typing import Annotated, Self

from fastapi import APIRouter, Query, Response
from pydantic import BaseModel, ConfigDict, StringConstraints, model_validator

from medleyplay.application.missing_detail_candidates import CandidateOrigin, CreditCandidate
from medleyplay.application.missing_details import DetailDecision, MissingDetailsPage
from medleyplay.domain.catalog import TrackId
from medleyplay.domain.jobs import JobView
from medleyplay.plugin_api.missing_details import CreditText, MissingField
from medleyplay.web.deps import MissingDetailsDep, SignedInAccount
from medleyplay.web.ids import RowId
from medleyplay.web.jobs import JobOut

router = APIRouter(prefix="/api/missing-details", tags=["missing details"])
type ReviewKey = Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]


class ReviewedIn(BaseModel):
    """The revision of the Track the listener reviewed."""

    model_config = ConfigDict(extra="forbid")
    key: ReviewKey


class DecisionIn(ReviewedIn):
    """Accept the named candidate, or keep the field blank when none is given."""

    field: MissingField
    origin: CandidateOrigin | None = None
    value: CreditText | None = None

    @model_validator(mode="after")
    def complete_candidate(self) -> Self:
        """Require both the candidate's value and origin or neither."""
        if (self.origin is None) != (self.value is None):
            message = "A candidate needs both its origin and value."
            raise ValueError(message)
        return self


@router.get("")
def missing(
    _: SignedInAccount,
    service: MissingDetailsDep,
    response: Response,
    after: Annotated[int, Query(ge=0, le=2**63 - 1)] = 0,
) -> MissingDetailsPage:
    """List a page of missing details and candidates without contacting a provider."""
    response.headers["Cache-Control"] = "private, no-store"
    return service.list(after)


@router.post("/{track_id}/ask", status_code=202)
def ask(
    track_id: RowId, body: ReviewedIn, me: SignedInAccount, service: MissingDetailsDep
) -> JobOut:
    """Queue an explicit AI request for this Track's missing fields."""
    return JobOut.of(JobView(service.ask(me, TrackId(track_id), body.key)), me)


@router.post("/{track_id}/decision", status_code=204)
def decide(
    track_id: RowId, body: DecisionIn, _: SignedInAccount, service: MissingDetailsDep
) -> None:
    """Save one still-current candidate or intentional blank."""
    candidate = (
        None
        if body.origin is None or body.value is None
        else CreditCandidate(body.value, body.origin)
    )
    service.decide(TrackId(track_id), DetailDecision(body.key, body.field, candidate))
