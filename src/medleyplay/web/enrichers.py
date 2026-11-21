"""The enrichers API: asking a site for a Track's details, only when someone asks."""

from datetime import datetime
from typing import Final

from fastapi import APIRouter, Request, Response, status
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

from medleyplay.application.enrichment import Askable, EnricherState
from medleyplay.domain.ai import MAX_HINT
from medleyplay.domain.catalog import TrackId
from medleyplay.domain.enrichers import EnricherMode, enricher_named
from medleyplay.web.cached import NOT_MODIFIED
from medleyplay.web.deps import AnswersDep, EnrichmentDep, JobsDep, SignedInAccount
from medleyplay.web.ids import RowId
from medleyplay.web.jobs import JobOut

router = APIRouter(prefix="/api/enrichers", tags=["enrichers"])


class StoppedOut(BaseModel):
    """Why an enricher stopped: the site refused a request."""

    at: datetime
    reason: str


class EnricherOut(BaseModel):
    """An enricher: whether it can be asked, whether the site stopped it, and for which Tracks."""

    name: str
    available: bool
    """Its plugin is on."""
    stopped: StoppedOut | None
    """Set after the site refused a request; nothing is asked until an admin resets it."""
    eligible: list[int]
    """The Tracks it may be asked about; none while it is stopped or turned off.

    A Track in `waiting` may be asked about once its time has come.
    """
    waiting: dict[int, datetime]
    """The Tracks asked about before, and when each may be asked again."""
    asks_again: bool
    """Someone may choose to ask again before the time comes: the AI only."""
    mode: EnricherMode
    """When the household has it asked: `manual`, `next` for the songs coming up, or `all`."""

    @classmethod
    def of(cls, state: EnricherState, askable: Askable) -> "EnricherOut":
        """Return the API view of `state` and the Tracks it may be asked about."""
        stopped = (
            None
            if state.stopped_at is None
            else StoppedOut(at=state.stopped_at, reason=state.reason)
        )
        return cls(
            name=state.name,
            available=state.available,
            stopped=stopped,
            eligible=list(askable.eligible) if state.available else [],
            waiting=dict(askable.waiting) if state.available else {},
            asks_again=enricher_named(state.name).uses_ai,
            mode=state.mode,
        )


ENRICHER: Final = TypeAdapter(EnricherOut)


class ModeIn(BaseModel):
    """When the household has the enricher asked."""

    model_config = ConfigDict(extra="forbid")

    mode: EnricherMode


class FindIn(BaseModel):
    """Ask the AI `again` without waiting a day since it was asked, with a `hint` of your own."""

    again: bool = False
    # White space is folded before the limit counts, so a note sent may run a little longer.
    hint: str = Field(default="", max_length=MAX_HINT * 2)


class QueuedOut(BaseModel):
    """How many Tracks were queued."""

    queued: int


@router.get("/{name}", response_model=EnricherOut, responses=NOT_MODIFIED)
def get_enricher(
    name: str,
    request: Request,
    _: SignedInAccount,
    enrichment: EnrichmentDep,
    answers: AnswersDep,
) -> Response:
    """Return the enricher's state and the Tracks it may be asked about.

    The answer holds no time of the reading, so it is kept while the rows stand; the
    page applies each wait. 304 when the request holds it already.
    """
    available = enrichment.state(name).available

    def build() -> EnricherOut:
        return EnricherOut.of(enrichment.state(name), enrichment.askable(name))

    # Whether the plugin is on is no row, so it names the answer too.
    return answers.answer(request, ("enricher", name, available), build, ENRICHER, heavy=True)


@router.post("/{name}/tracks/{track_id}")
def find_details(
    name: str,
    track_id: RowId,
    me: SignedInAccount,
    enrichment: EnrichmentDep,
    jobs: JobsDep,
    body: FindIn | None = None,
) -> JobOut:
    """Ask the enricher about one Track; 409 when it is not eligible.

    The Job waits while the Mode is Offline. Asking again returns the active Job; asking
    the AI `again`, or with a `hint`, while it works on the Track answers 409.
    """
    asked = body or FindIn()
    job = enrichment.find_details(me, TrackId(track_id), name, again=asked.again, hint=asked.hint)
    return JobOut.of(jobs.get_job(job.id), me)


@router.post("/{name}/find-all")
def find_details_for_all(name: str, me: SignedInAccount, enrichment: EnrichmentDep) -> QueuedOut:
    """Queue the enricher for every eligible Track, and say how many; admins only."""
    return QueuedOut(queued=enrichment.find_details_for_all(me, name))


@router.put("/{name}/mode")
def set_mode(
    name: str, body: ModeIn, me: SignedInAccount, enrichment: EnrichmentDep
) -> EnricherOut:
    """Choose when the enricher is asked; admins only. Finding all queues every Track at once."""
    state = enrichment.set_mode(me, name, body.mode)
    return EnricherOut.of(state, enrichment.askable(name))


@router.post("/{name}/reset", status_code=status.HTTP_204_NO_CONTENT)
def reset_enricher(name: str, me: SignedInAccount, enrichment: EnrichmentDep) -> None:
    """Let a stopped enricher be asked again; admins only. Resetting one that runs is fine."""
    enrichment.reset(me, name)
