"""Write safe download receipts and read them only for the requester or an admin."""

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Final

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from medleyplay.application.download_holds import hold_of, job_selection
from medleyplay.domain.accounts import Account
from medleyplay.domain.download_holds import HoldReason
from medleyplay.domain.downloads import DOWNLOAD_KIND, source_of_target
from medleyplay.domain.errors import NotFoundError
from medleyplay.domain.jobs import JobId, JobState
from medleyplay.download_receipts import (
    DownloadEvent,
    DownloadReason,
    DownloadRoute,
    DownloadStage,
    reason_for,
)
from medleyplay.persistence.schema import DownloadReceiptRow, DownloadRow, JobRow

RECEIPT_AGE: Final = timedelta(days=14)
MAX_RECEIPTS: Final = 10_000
MAX_STAGE_RECEIPTS: Final = 30


@dataclass(frozen=True)
class Receipt:
    """Data safe to retain and export without reading a raw tool message."""

    event: DownloadEvent
    attempt: int | None = None
    route: DownloadRoute | None = None
    stage: DownloadStage | None = None
    part: int | None = None
    reason: DownloadReason | None = None
    http_status: int | None = None
    retry_at: datetime | None = None


@dataclass(frozen=True, kw_only=True)
class TimelineEntry(Receipt):
    """A stored receipt, with its stable key and server time."""

    sequence: int
    at: datetime


@dataclass(frozen=True, kw_only=True)
class DownloadDiagnostics:
    """A download's safe, private snapshot and its retained receipts."""

    version: int = 1
    job_id: JobId
    state: JobState
    has_saved_audio: bool
    attempts: int
    max_attempts: int
    waits_for_online: bool
    retry_at: datetime | None
    hold: HoldReason | None
    reason: DownloadReason | None
    http_status: int | None
    events: tuple[TimelineEntry, ...]


def append_receipt(db: Session, job_id: int, now: datetime, receipt: Receipt) -> None:
    """Add a receipt with its state transaction, or cap optional stages per attempt."""
    if receipt.event is DownloadEvent.STAGE:
        stages = (
            select(func.count())
            .select_from(DownloadReceiptRow)
            .where(
                DownloadReceiptRow.job_id == job_id,
                DownloadReceiptRow.attempt == receipt.attempt,
                DownloadReceiptRow.event == DownloadEvent.STAGE,
            )
        )
        if (db.scalar(stages) or 0) >= MAX_STAGE_RECEIPTS:
            return
    db.add(DownloadReceiptRow(job_id=job_id, at=now, **vars(receipt)))
    db.flush()
    prune_receipts(db, now)


def prune_receipts(db: Session, now: datetime) -> None:
    """Remove expired receipts and the oldest entries above the global limit."""
    receipt = DownloadReceiptRow
    db.execute(delete(receipt).where(receipt.at < now - RECEIPT_AGE))
    excess = select(receipt.id).order_by(receipt.id.desc()).offset(MAX_RECEIPTS)
    db.execute(delete(receipt).where(receipt.id.in_(excess)))


def download_timeline(
    db: Session,
    viewer: Account,
    job_id: JobId,
    now: datetime,
    *,
    online: bool,
    max_attempts: int,
) -> DownloadDiagnostics:
    """Read a download trace without revealing whether another Account's trace exists."""
    job = db.get(JobRow, job_id)
    if (
        job is None
        or job.kind != DOWNLOAD_KIND
        or not (viewer.is_admin or viewer.id == job.requested_by)
    ):
        message = "There is no such download trace."
        raise NotFoundError(message)
    selection = job_selection(job.kind, job.request)
    hold = None if selection is None else hold_of(db, selection)
    pending = job.state in {JobState.WAITING, JobState.QUEUED}
    source = source_of_target(job.target)
    retry_at = job.not_before if pending and job.not_before and job.not_before > now else None
    rows = db.scalars(
        select(DownloadReceiptRow)
        .where(DownloadReceiptRow.job_id == job_id, DownloadReceiptRow.at >= now - RECEIPT_AGE)
        .order_by(DownloadReceiptRow.id)
    )
    return DownloadDiagnostics(
        job_id=job_id,
        state=JobState(job.state),
        has_saved_audio=source is not None and db.get(DownloadRow, source) is not None,
        attempts=job.provider_attempts or 0,
        max_attempts=max_attempts,
        waits_for_online=pending and not online,
        retry_at=retry_at,
        hold=hold,
        reason=reason_for(job.failure_kind),
        http_status=job.provider_http_status,
        events=tuple(_entry(row) for row in rows),
    )


def _entry(row: DownloadReceiptRow) -> TimelineEntry:
    return TimelineEntry(
        sequence=row.id,
        at=row.at,
        event=DownloadEvent(row.event),
        attempt=row.attempt,
        route=None if row.route is None else DownloadRoute(row.route),
        stage=None if row.stage is None else DownloadStage(row.stage),
        part=row.part,
        reason=reason_for(row.reason),
        http_status=row.http_status,
        retry_at=row.retry_at,
    )
