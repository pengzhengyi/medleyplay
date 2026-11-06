"""The enrichers API: asking a site for a Track's details, only when someone asks."""

from datetime import datetime

from fastapi import APIRouter, status
from pydantic import BaseModel, ConfigDict

from medleyplay.application.enrichment import EnricherState
from medleyplay.domain.catalog import TrackId
from medleyplay.domain.enrichers import EnricherMode
from medleyplay.web.deps import EnrichmentDep, JobsDep, SignedInAccount
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
    """The Tracks it may be asked about now; none while it is stopped or turned off."""
    mode: EnricherMode
    """When the household has it asked: `manual`, `next` for the songs coming up, or `all`."""

    @classmethod
    def of(cls, state: EnricherState, eligible: list[TrackId]) -> "EnricherOut":
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
            eligible=list(eligible) if state.available else [],
            mode=state.mode,
        )


class ModeIn(BaseModel):
    """When the household has the enricher asked."""

    model_config = ConfigDict(extra="forbid")

    mode: EnricherMode


class QueuedOut(BaseModel):
    """How many Tracks were queued."""

    queued: int


@router.get("/{name}")
def get_enricher(name: str, _: SignedInAccount, enrichment: EnrichmentDep) -> EnricherOut:
    """Return the enricher's state and the Tracks it may be asked about."""
    return EnricherOut.of(enrichment.state(name), enrichment.eligible(name))


@router.post("/{name}/tracks/{track_id}")
def find_details(
    name: str, track_id: RowId, me: SignedInAccount, enrichment: EnrichmentDep, jobs: JobsDep
) -> JobOut:
    """Ask the enricher about one Track; 409 when it is not eligible.

    The Job waits while the Mode is Offline. Asking again returns the active Job.
    """
    job = enrichment.find_details(me, TrackId(track_id), name)
    return JobOut.of(jobs.get_job(job.id))


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
    return EnricherOut.of(state, enrichment.eligible(name))


@router.post("/{name}/reset", status_code=status.HTTP_204_NO_CONTENT)
def reset_enricher(name: str, me: SignedInAccount, enrichment: EnrichmentDep) -> None:
    """Let a stopped enricher be asked again; admins only. Resetting one that runs is fine."""
    enrichment.reset(me, name)
