"""Check durable download Holds before admitting or dispatching provider work."""

from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Final

from sqlalchemy import ColumnElement, and_, delete, or_, select
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.orm import Session

from medleyplay.domain.download_holds import DownloadHoldKey, DownloadSelection, HoldReason
from medleyplay.domain.downloads import DOWNLOAD_KIND
from medleyplay.domain.enrichers import BILIBILI_DETAILS
from medleyplay.domain.errors import ConflictError, InvalidInputError
from medleyplay.domain.jobs import VIDEO_LOOKUP, JobState
from medleyplay.domain.links import BILIBILI_SOURCE, video_selection
from medleyplay.persistence.schema import (
    DownloadHoldRow,
    JobRow,
    ProviderDispatchRow,
    ProxyRow,
    SourceRow,
    VideoLookupRow,
)

HOLD_MESSAGE: Final = "Download held. Medleyplay will not ask the provider again."
BUSY_MESSAGE: Final = "Bilibili is busy. Wait for the current request to finish."
UNCERTAIN_MESSAGE: Final = (
    "The provider attempt ended without a confirmed outcome. No retry scheduled."
)
MAX_HELD_VIDEOS: Final = 512
DIRECT_ROUTE: Final = "direct"


class DownloadHeldError(ConflictError):
    """The provider selection has a durable Hold."""


def hold_of(db: Session, selection: DownloadSelection) -> HoldReason | None:
    """Return the reason to stop if a Hold covers any selected part."""
    row = db.scalar(
        select(DownloadHoldRow.reason)
        .where(
            DownloadHoldRow.site == selection.site,
            DownloadHoldRow.subject == selection.key().subject,
            DownloadHoldRow.part.in_((0, *selection.parts)),
        )
        .order_by(DownloadHoldRow.part)
        .limit(1)
    )
    return None if row is None else HoldReason(row)


def held_videos(db: Session, site: str) -> tuple[str, ...] | None:
    """Return the bounded set to check after resolving a short link, or refuse to dispatch."""
    subjects = db.scalars(
        select(DownloadHoldRow.subject)
        .where(
            DownloadHoldRow.site == site,
            DownloadHoldRow.part == 0,
            DownloadHoldRow.subject.startswith("video:"),
        )
        .limit(MAX_HELD_VIDEOS + 1)
    )
    videos = tuple(value.removeprefix("video:") for value in subjects)
    return videos if len(videos) <= MAX_HELD_VIDEOS else None


def record_hold(
    db: Session,
    key: DownloadHoldKey,
    reason: HoldReason,
    job: JobRow | None = None,
) -> None:
    """Keep the first Hold evidence for an identity in the caller's transaction."""
    db.execute(
        insert(DownloadHoldRow)
        .values(
            site=key.site,
            subject=key.subject,
            part=key.part,
            reason=reason,
            job_id=job.id if job is not None else None,
            attempt=job.provider_attempts if job is not None else None,
        )
        .on_conflict_do_nothing()
    )


def require_clear(db: Session, selection: DownloadSelection) -> None:
    """Refuse scheduling a selection covered by a durable Hold."""
    if hold_of(db, selection) is not None:
        raise DownloadHeldError(HOLD_MESSAGE)


def source_is_held(db: Session, site: str, locator: str) -> bool:
    """Return whether a Source or one of its joined parts has a Hold."""
    if site != BILIBILI_SOURCE:
        return False
    selection = video_selection(locator)
    return hold_of(db, DownloadSelection(site, selection.video, selection.parts)) is not None


def held_sources(db: Session) -> set[int]:
    """Find held site Sources in a bulk policy read."""
    subjects = {
        (site, subject, part)
        for site, subject, part in db.execute(
            select(DownloadHoldRow.site, DownloadHoldRow.subject, DownloadHoldRow.part)
        )
    }
    if not subjects:
        return set()
    held: set[int] = set()
    for source_id, site, locator in db.execute(
        select(SourceRow.id, SourceRow.kind, SourceRow.locator).where(
            SourceRow.kind == BILIBILI_SOURCE
        )
    ):
        selection = video_selection(locator)
        subject = DownloadSelection(site, selection.video).key().subject
        if any((site, subject, part) in subjects for part in (0, *selection.parts)):
            held.add(source_id)
    return held


def job_selection(kind: str, raw: Mapping[str, object]) -> DownloadSelection | None:
    """Identify the provider request of a persisted Job without contacting the site."""
    if kind == VIDEO_LOOKUP and isinstance(link := raw.get("link"), str):
        try:
            return DownloadSelection.from_link(link)
        except InvalidInputError:
            return None
    video = raw.get("video")
    if not isinstance(video, str):
        return None
    if kind == DOWNLOAD_KIND and raw.get("site") == BILIBILI_SOURCE:
        return DownloadSelection(BILIBILI_SOURCE, video, _parts(raw))
    if kind == "enrich_track" and raw.get("enricher") == BILIBILI_DETAILS.name:
        return DownloadSelection(BILIBILI_SOURCE, video)
    return None


def provider_jobs() -> ColumnElement[bool]:
    """Match Jobs that can make an outbound Bilibili request."""
    request = JobRow.__table__.c.request
    return or_(
        JobRow.kind == VIDEO_LOOKUP,
        and_(JobRow.kind == DOWNLOAD_KIND, request["site"].as_string() == BILIBILI_SOURCE),
        and_(
            JobRow.kind == "enrich_track",
            request["enricher"].as_string() == BILIBILI_DETAILS.name,
        ),
    )


def _parts(raw: Mapping[str, object]) -> tuple[int, ...]:
    if isinstance(part := raw.get("part"), int):
        return (part,)
    parts = raw.get("parts")
    return tuple(part for part in parts if isinstance(part, int)) if isinstance(parts, list) else ()


def reserve_dispatch(db: Session, selection: DownloadSelection, job_id: int | None) -> bool:
    """Reserve the one provider lane before handing off any outbound request."""
    created = db.execute(
        insert(ProviderDispatchRow)
        .values(site=selection.site, subject=selection.key().subject, job_id=job_id)
        .on_conflict_do_nothing()
        .returning(ProviderDispatchRow.site)
    ).scalar_one_or_none()
    return created is not None


def provider_dispatch_exists(db: Session) -> bool:
    """Return whether a Bilibili attempt owns the outbound lane."""
    return db.get(ProviderDispatchRow, BILIBILI_SOURCE) is not None


def provider_route(db: Session, site: str) -> str | None:
    """Return the configured route generation without reading its URL or credentials."""
    proxy = db.get(ProxyRow, site)
    return DIRECT_ROUTE if proxy is None else proxy.generation


def release_dispatch(db: Session, site: str, job_id: int | None) -> None:
    """Release only the dispatch owned by this Job or the synchronous path."""
    db.execute(
        delete(ProviderDispatchRow).where(
            ProviderDispatchRow.site == site, ProviderDispatchRow.job_id == job_id
        )
    )


def hold_dispatched_job(db: Session, job_id: int) -> None:
    """Keep uncertainty if cancellation wins after a provider dispatch was reserved."""
    dispatch = db.scalar(select(ProviderDispatchRow).where(ProviderDispatchRow.job_id == job_id))
    if dispatch is not None:
        record_hold(db, _dispatch_key(dispatch), HoldReason.UNCERTAIN, db.get(JobRow, job_id))


def _dispatch_key(dispatch: ProviderDispatchRow) -> DownloadHoldKey:
    kind, _, identity = dispatch.subject.partition(":")
    if kind == "short":
        return DownloadHoldKey(dispatch.site, short=identity)
    return DownloadHoldKey(dispatch.site, video=identity)


def recover_dispatches(db: Session, stopped: set[int], now: datetime) -> list[JobRow]:
    """Hold possibly sent requests before beginning a new runner session."""
    interrupted: list[JobRow] = []
    for dispatch in db.scalars(select(ProviderDispatchRow)):
        job = db.get(JobRow, dispatch.job_id) if dispatch.job_id is not None else None
        record_hold(db, _dispatch_key(dispatch), HoldReason.UNCERTAIN, job)
        if job is not None:
            if JobState(job.state).is_active:
                _hold_legacy_job(job, now)
                interrupted.append(job)
            if job.id in stopped:
                db.delete(dispatch)
    return interrupted


def classify_legacy_jobs(db: Session, now: datetime) -> None:
    """Classify old Jobs before they can be requeued or retried by policy."""
    legacy = list(
        db.scalars(select(JobRow).where(JobRow.provider_attempts.is_(None), provider_jobs()))
    )
    for job in legacy:
        if job.kind == VIDEO_LOOKUP and job.state == JobState.SUCCEEDED:
            _hold_ambiguous_lookup(db, job)
            continue
        job.provider_attempts = 0
        selection = job_selection(job.kind, job.request)
        if selection is None or not _legacy_is_uncertain(job):
            continue
        record_hold(db, selection.key(), HoldReason.UNCERTAIN, job)
        _hold_legacy_job(job, now)


def _hold_ambiguous_lookup(db: Session, job: JobRow) -> None:
    saved = db.get(VideoLookupRow, job.id)
    if (
        saved is None
        or saved.result is None
        or not isinstance(read := saved.result.get("read"), dict)
    ):
        return
    if "reason" in read and read["reason"] not in ("gone", "needs_login"):
        if (selection := job_selection(job.kind, job.request)) is not None:
            record_hold(db, selection.key(), HoldReason.UNCERTAIN, job)
        video = saved.result.get("video")
        if isinstance(video, str):
            selection = DownloadSelection(BILIBILI_SOURCE, video=video)
            record_hold(db, selection.key(), HoldReason.UNCERTAIN, job)


def _legacy_is_uncertain(job: JobRow) -> bool:
    if job.state in {JobState.RUNNING, JobState.WAITING, JobState.FAILED}:
        return True
    return job.state in {JobState.QUEUED, JobState.CANCELLED} and (
        job.started_at is not None or job.attempts != 0 or job.failure_kind is not None
    )


def _hold_legacy_job(job: JobRow, now: datetime) -> None:
    if JobState(job.state).is_active:
        job.state = JobState.FAILED
    if job.state != JobState.CANCELLED:
        job.failure_kind = HoldReason.UNCERTAIN
        job.failure_message = UNCERTAIN_MESSAGE
    job.finished_at = job.finished_at or now
    job.not_before = None
    job.pid = None


def require_clear_parts(db: Session, site: str, video: str, parts: Sequence[int]) -> None:
    """Reject the entire requested selection if any part is on Hold."""
    require_clear(db, DownloadSelection(site, video, tuple(parts)))
