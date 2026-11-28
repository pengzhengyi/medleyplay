"""Receipt retention never removes the download's terminal status."""

from datetime import timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application import download_diagnostics
from medleyplay.application.download_diagnostics import Receipt, append_receipt
from medleyplay.domain.jobs import JobState
from medleyplay.download_receipts import DownloadEvent, DownloadReason, DownloadStage
from medleyplay.persistence.schema import DownloadReceiptRow, JobRow
from tests.support.fakes import FakeClock


def _failed_job(db: Session, clock: FakeClock, target: str) -> int:
    job = JobRow(
        kind="download_source",
        target=target,
        request={},
        state=JobState.FAILED,
        created_at=clock(),
        finished_at=clock(),
        provider_attempts=1,
        failure_kind="response_unknown",
        provider_http_status=567,
    )
    db.add(job)
    db.flush()
    return job.id


def test_stages_cannot_use_the_space_reserved_for_dispatch_and_outcome(
    units: sessionmaker[Session], clock: FakeClock, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(download_diagnostics, "MAX_STAGE_RECEIPTS", 2)
    with units.begin() as db:
        job = _failed_job(db, clock, "source:7")
        append_receipt(db, job, clock(), Receipt(DownloadEvent.DISPATCHED, attempt=1))
        for part in range(1, 5):
            append_receipt(
                db,
                job,
                clock(),
                Receipt(DownloadEvent.STAGE, attempt=1, stage=DownloadStage.TRANSFER, part=part),
            )
        append_receipt(
            db,
            job,
            clock(),
            Receipt(DownloadEvent.FAILED, attempt=1, reason=DownloadReason.RESPONSE_UNKNOWN),
        )

    with units() as db:
        events = db.execute(
            select(DownloadReceiptRow.event, DownloadReceiptRow.part).order_by(
                DownloadReceiptRow.id
            )
        ).all()

    assert events == [("dispatched", None), ("stage", 1), ("stage", 2), ("failed", None)]


def test_expiration_and_global_retention_do_not_remove_the_current_failure(
    units: sessionmaker[Session], clock: FakeClock, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(download_diagnostics, "MAX_RECEIPTS", 2)
    with units.begin() as db:
        first = _failed_job(db, clock, "source:1")
        expired = _failed_job(db, clock, "source:2")
        append_receipt(db, expired, clock() - timedelta(days=15), Receipt(DownloadEvent.QUEUED))
        append_receipt(db, first, clock(), Receipt(DownloadEvent.QUEUED))

    with units() as db:
        assert db.scalars(select(DownloadReceiptRow.job_id)).all() == [first]

    with units.begin() as db:
        newest = _failed_job(db, clock, "source:3")
        append_receipt(db, newest, clock(), Receipt(DownloadEvent.QUEUED))
        append_receipt(db, newest, clock(), Receipt(DownloadEvent.DISPATCHED, attempt=1))

    with units() as db:
        assert db.scalars(select(DownloadReceiptRow.job_id)).all() == [newest, newest]
        failure = db.get_one(JobRow, first)
        assert (failure.failure_kind, failure.provider_http_status) == ("response_unknown", 567)
