"""Account-owned video lookup Jobs and the part choices they leave in Downloads."""

import threading
from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import select, update
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.jobs import JobKind, JobService, Lane
from medleyplay.application.links import Added, AlbumChoice, LinkService, Lookup, PartChoice
from medleyplay.application.plugins import PluginService
from medleyplay.domain.accounts import Account
from medleyplay.domain.errors import ConflictError, InvalidInputError, NotFoundError
from medleyplay.domain.jobs import VIDEO_LOOKUP, Job, JobId, JobState
from medleyplay.domain.links import BILIBILI_SOURCE, lookup_link
from medleyplay.persistence.schema import JobRow, VideoLookupRow
from medleyplay.plugin_api import SOURCE_RESOLVER
from medleyplay.programs.lookup_video import Reason, Resolved, Unreadable, VideoRequest


def _open(db: Session, job: Job) -> None:
    db.add(VideoLookupRow(job_id=job.id))


def _complete(db: Session, job: Job, result: Resolved) -> None:
    db.execute(
        update(VideoLookupRow)
        .where(VideoLookupRow.job_id == job.id)
        .values(result=result.model_dump(mode="json"))
    )


LOOKUP_KIND = JobKind(
    name=VIDEO_LOOKUP,
    program="medleyplay.programs.lookup_video:LOOKUP_VIDEO",
    request=VideoRequest,
    result=Resolved,
    complete=_complete,
    on_submit=_open,
    points=(SOURCE_RESOLVER.name,),
    needs_network=True,
    lane_field="site",
    lanes={BILIBILI_SOURCE: Lane(proxy_site=BILIBILI_SOURCE)},
)


@dataclass(frozen=True)
class SavedLookup:
    """A summary for Downloads, with the part choices only when opened."""

    id: JobId
    label: str
    state: JobState
    message: str
    result: Lookup | None = None


class VideoLookups:
    """Keep results until the submitting Account confirms its choices or dismisses them."""

    def __init__(
        self,
        units: sessionmaker[Session],
        links: LinkService,
        jobs: JobService,
        plugins: PluginService,
    ) -> None:
        """Use the server's runner and the same catalog commands as a direct add."""
        self._units = units
        self._links = links
        self._jobs = jobs
        self._plugins = plugins
        self._choices = threading.Lock()

    def start(self, me: Account, text: str) -> SavedLookup:
        """Queue the lookup without contacting the site, or reopen the same pending choice."""
        self._links.require_online()
        link = lookup_link(text)
        target = f"account:{me.id}:{link}"
        with self._choices:
            with self._units() as db:
                existing = db.scalar(
                    select(JobRow.id)
                    .join(VideoLookupRow)
                    .where(
                        JobRow.requested_by == me.id,
                        JobRow.target == target,
                        JobRow.state.not_in((JobState.FAILED, JobState.CANCELLED)),
                    )
                )
            if existing is not None:
                return self.get(me, JobId(existing))
            if BILIBILI_SOURCE not in self._plugins.available_keys().get(SOURCE_RESOLVER.name, []):
                message = "No plugin is available to look up Bilibili videos."
                raise InvalidInputError(message)
            job = self._jobs.submit(LOOKUP_KIND, target, VideoRequest(link=link), me.id)
            return self.get(me, job.id)

    def list_for(self, me: Account) -> list[SavedLookup]:
        """List open lookups newest first without loading their parts."""
        with self._units() as db:
            rows = db.execute(
                select(JobRow, VideoLookupRow.result["read"]["title"].as_string())
                .join(VideoLookupRow)
                .where(JobRow.requested_by == me.id)
                .order_by(JobRow.id.desc())
            )
            return [_summary(job, title) for job, title in rows]

    def get(self, me: Account, job_id: JobId) -> SavedLookup:
        """Open a lookup, checking current catalog membership without asking the site."""
        with self._units() as db:
            job, row = _owned(db, me, job_id)
            preview = (
                None
                if row.result is None
                else self._links.preview(Resolved.model_validate(row.result), caller=me)
            )
            return _summary(job, preview.title if preview else "", preview)

    def retry_part(self, me: Account, job_id: JobId, part: int, failed: JobId) -> Job:
        """Queue one retried part without consuming the caller's saved lookup."""
        with self._choices, self._units.begin() as db:
            db.connection().exec_driver_sql("BEGIN IMMEDIATE")
            resolved = _confirmable(*_owned(db, me, job_id))
            job = self._links.retry_part_in(db, me, resolved, part, failed)
        self._jobs.announce_queued(job.id)
        self._links.announce_import()
        return job

    def confirm(
        self, me: Account, job_id: JobId, quality: str, parts: Sequence[PartChoice]
    ) -> list[Added]:
        """Validate the choices against the saved read; close it only after a successful add."""
        with self._choices:
            with self._units() as db:
                resolved = _confirmable(*_owned(db, me, job_id))
            added = self._links.add_resolved(me, resolved, quality, parts)
            self._close(me, job_id)
            return added

    def dismiss(self, me: Account, job_id: JobId) -> None:
        """Remove this choice and stop the lookup if it is still active."""
        with self._choices:
            self._close(me, job_id)

    def import_parts(
        self,
        me: Account,
        job_id: JobId,
        quality: str,
        album: AlbumChoice | None,
        numbers: Sequence[int] | None,
    ) -> list[Added]:
        """Consume this Account's saved result only if the entire import commits."""
        with self._choices, self._units.begin() as db:
            db.connection().exec_driver_sql("BEGIN IMMEDIATE")
            job, row = _owned(db, me, job_id)
            added = self._links.import_in(db, me, _confirmable(job, row), quality, album, numbers)
            db.delete(row)
        self._jobs.announce_queued(*(p.job.id for p in added if p.job is not None))
        self._jobs.notify(job_id)
        self._links.announce_import()
        return added

    def _close(self, me: Account, job_id: JobId) -> None:
        with self._units.begin() as db:
            job, row = _owned(db, me, job_id)
            cancelled = (
                self._jobs.cancel_active_in(db, job.kind, job.target)
                if JobState(job.state).is_active
                else None
            )
            db.delete(row)
        if cancelled is not None:
            self._jobs.announce_cancelled(cancelled)
        else:
            self._jobs.notify(job_id)


def _confirmable(job: JobRow, row: VideoLookupRow) -> Resolved:
    if job.state != JobState.SUCCEEDED or row.result is None:
        message = "This video has no parts ready to choose."
        raise ConflictError(message)
    resolved = Resolved.model_validate(row.result)
    if (
        job.provider_attempts is None
        and isinstance(resolved.read, Unreadable)
        and resolved.read.reason not in {Reason.GONE, Reason.NEEDS_LOGIN}
    ):
        message = "This saved lookup has no confirmed provider outcome."
        raise ConflictError(message)
    return resolved


def _owned(db: Session, me: Account, job_id: JobId) -> tuple[JobRow, VideoLookupRow]:
    pair = db.execute(
        select(JobRow, VideoLookupRow)
        .join(VideoLookupRow)
        .where(JobRow.requested_by == me.id, JobRow.id == job_id)
    ).one_or_none()
    if pair is None:
        message = "There is no such video lookup."
        raise NotFoundError(message)
    return pair[0], pair[1]


def _summary(job: JobRow, title: str | None, result: Lookup | None = None) -> SavedLookup:
    return SavedLookup(
        JobId(job.id),
        title or str(job.request["link"]),
        JobState(job.state),
        job.failure_message,
        result,
    )
