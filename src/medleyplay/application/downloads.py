"""Downloads: starting the Job that downloads a site's Source, and recording what it made.

Completion publishes the staged file under a fresh name before committing the
Download pointer. Startup cleanup removes files no Download or active reader names.
"""

import stat
from collections.abc import Sequence
from datetime import timedelta
from functools import partial
from pathlib import Path, PurePosixPath
from typing import Final

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application import Clock
from medleyplay.application.catalog import dismissed_download_tracks
from medleyplay.application.download_budgets import (
    DownloadBudget,
    disk_refusal,
    estimate_of,
    limit_refusal,
)
from medleyplay.application.download_files import (
    forget_download_silences,
    publish_staged,
    sweep_download_files,
)
from medleyplay.application.download_holds import job_selection, source_is_held
from medleyplay.application.jobs import (
    JobCompletion,
    JobKind,
    JobService,
    Lane,
    queue_job_in,
    to_job,
)
from medleyplay.application.linked_accounts import LinkedAccountService
from medleyplay.application.plugins import PluginService
from medleyplay.domain.accounts import Account, AccountId, Role
from medleyplay.domain.catalog import SourceId, SourceState, TrackId
from medleyplay.domain.download_holds import NO_AUTOMATIC_RETRY, DownloadSelection
from medleyplay.domain.downloads import (
    DOWNLOAD_EXTENSIONS,
    DOWNLOAD_KIND,
    DOWNLOADS_FOLDER,
    JOIN_ESTIMATE_DETAIL,
    JOIN_LANE,
    QUALITY_DETAIL,
    download_name,
    download_target,
)
from medleyplay.domain.errors import ConflictError, InvalidInputError, NotFoundError
from medleyplay.domain.jobs import ACTIVE_STATES, Job, JobId, JobState
from medleyplay.domain.links import BILIBILI_SOURCE, joined_locator, video_selection
from medleyplay.download_limits import JOIN_SCRATCH_BYTES, MAX_DOWNLOAD_BYTES
from medleyplay.download_receipts import DOWNLOAD_PROGRAM, DownloadReason
from medleyplay.persistence.schema import AccountRow, DownloadRow, JobRow, SourceRow, TrackRow
from medleyplay.plugin_api import BEST_QUALITY, SOURCE_DOWNLOADER
from medleyplay.programs.download_source import (
    DOWNLOAD_FOLDER,
    DownloadedSource,
    DownloadSource,
)
from medleyplay.programs.joined_audio import join_tools

SERVED_EVERY: Final = timedelta(minutes=1)
"""How often a Download's last served time is written, since a player asks for many ranges."""

type DownloadKind = JobKind[DownloadSource, DownloadedSource]


def download_source_kind(data_dir: Path, jobs_dir: Path, clock: Clock) -> DownloadKind:
    """Return the Job kind that downloads a Bilibili Source into `downloads/` in `data_dir`.

    The Job uses the submitting Account's Bilibili login, when it has a valid one.
    """
    return JobKind(
        name=DOWNLOAD_KIND,
        program=DOWNLOAD_PROGRAM,
        request=DownloadSource,
        result=DownloadedSource,
        complete=partial(_complete, data_dir=data_dir, jobs_dir=jobs_dir, clock=clock),
        points=(SOURCE_DOWNLOADER.name,),
        login_site=BILIBILI_SOURCE,
        proxy_site=BILIBILI_SOURCE,
        needs_network=True,
        lane_field="lane",
        lanes={JOIN_LANE: Lane(proxy_site=BILIBILI_SOURCE)},
        lane_optional=True,
        on_submit=partial(_admit, data_dir=data_dir),
        refuse_start=partial(_refuse_start, data_dir=data_dir),
    )


def _complete(
    db: Session,
    job: Job,
    downloaded: DownloadedSource,
    *,
    data_dir: Path,
    jobs_dir: Path,
    clock: Clock,
) -> JobCompletion | None:
    source_id = SourceId(int(job.target.removeprefix("source:")))
    source = _current_job_source(db, job, source_id)
    if source is None:
        return JobCompletion(failure=("refused", "The Source is no longer in the Library."))
    joined = video_selection(source.locator).joined
    existing = db.get(DownloadRow, source_id)
    if joined and existing is not None:
        return None
    if downloaded.gone:
        source.state = SourceState.UNAVAILABLE
        return JobCompletion(diagnostic_reason=DownloadReason.GONE)
    if joined and (refusal := limit_refusal(db, data_dir, source_id, downloaded.size)):
        return JobCompletion(failure=("refused", refusal))
    try:
        name = _publish_download(data_dir, jobs_dir, job.id, source_id, downloaded)
    except (InvalidInputError, OSError):
        return JobCompletion(
            failure=("invalid_artifact", "The staged audio could not be published.")
        )
    row = existing or DownloadRow(source_id=source_id)
    row.file_name = name
    row.quality = downloaded.quality
    row.backend = downloaded.backend
    row.size = downloaded.size
    row.downloaded_at = clock()
    db.add(row)
    forget_download_silences(db, TrackId(source.track_id))
    if joined:
        source.details = {**(source.details or {}), JOIN_ESTIMATE_DETAIL: downloaded.size}
        if downloaded.duration_ms is not None:
            db.get_one(TrackRow, source.track_id).duration_ms = downloaded.duration_ms
    return None


def _current_job_source(db: Session, job: Job, source_id: SourceId) -> SourceRow | None:
    source = db.get(SourceRow, source_id)
    if source is None or source.kind != BILIBILI_SOURCE:
        return None
    request = db.get_one(JobRow, job.id).request
    expected = job_selection(job.kind, request)
    if expected is None:
        return None
    selected = video_selection(source.locator)
    actual = DownloadSelection(source.kind, selected.video, selected.parts)
    if (
        expected.key().subject != actual.key().subject
        or expected.parts != actual.parts
        or selected.joined != (request.get("parts") is not None)
    ):
        return None
    return source


def _publish_download(
    data_dir: Path, jobs_dir: Path, job: JobId, source: SourceId, downloaded: DownloadedSource
) -> str:
    file = downloaded.file
    if file is None or PurePosixPath(file).name != file or "\\" in file:
        message = "The staged audio must be directly in the download Job's folder."
        raise InvalidInputError(message)
    staged = jobs_dir / str(job) / DOWNLOAD_FOLDER / file
    return publish_staged(
        data_dir / DOWNLOADS_FOLDER,
        staged,
        download_name(source, file),
        downloaded.size,
        MAX_DOWNLOAD_BYTES,
    )


def _admit(db: Session, job: Job, *, data_dir: Path) -> None:
    source = db.get(SourceRow, int(job.target.removeprefix("source:")))
    if source is None:
        message = "The Source is no longer in the Library."
        raise NotFoundError(message)
    if not video_selection(source.locator).joined:
        return
    existing = db.get(DownloadRow, source.id)
    if existing is not None and not _saved_on_disk(existing, data_dir / DOWNLOADS_FOLDER):
        db.delete(existing)
        db.flush()
    if refusal := _join_refusal(db, source, data_dir, starting=False):
        raise ConflictError(refusal)


def _refuse_start(db: Session, raw: object, *, data_dir: Path) -> str | None:
    if not isinstance(raw, dict) or raw.get("parts") is None:
        return None
    request = DownloadSource.model_validate(raw)
    if request.parts is None:
        return None
    source = db.scalar(
        select(SourceRow).where(
            SourceRow.kind == request.site,
            SourceRow.locator == joined_locator(request.video, request.parts),
        )
    )
    if source is None:
        return "The joined album is no longer in the Library."
    return _join_refusal(db, source, data_dir, starting=True)


class DownloadService:
    """Start Downloads, and remove files no Download names."""

    def __init__(
        self,
        units: sessionmaker[Session],
        plugins: PluginService,
        jobs: JobService,
        kind: DownloadKind,
        linked: LinkedAccountService,
        data_dir: Path,
        clock: Clock,
    ) -> None:
        """Create a service keeping Downloads in `downloads/` in `data_dir`."""
        self._clock = clock
        self._units = units
        self._plugins = plugins
        self._jobs = jobs
        self._kind = kind
        self._linked = linked
        self.folder = data_dir / DOWNLOADS_FOLDER

    def dismissed_retries_in(
        self, db: Session, caller: Account, sources: Sequence[SourceRow]
    ) -> dict[str, JobId]:
        """Return dismissed sign-in failures the caller can retry, by Source locator."""
        renewed = self._linked.valid_saved_at_in(db, caller.id, BILIBILI_SOURCE)
        if renewed is None or BILIBILI_SOURCE not in self._plugins.available_keys().get(
            SOURCE_DOWNLOADER.name, []
        ):
            return {}
        targets = {
            download_target(SourceId(source.id)): source
            for source in sources
            if source.kind == BILIBILI_SOURCE and source.state != SourceState.UNAVAILABLE
        }
        if not targets:
            return {}
        latest = (
            select(func.max(JobRow.id))
            .where(JobRow.kind == DOWNLOAD_KIND, JobRow.target.in_(targets))
            .group_by(JobRow.target)
        )
        eligible = select(JobRow.target, JobRow.id).where(
            JobRow.id.in_(latest),
            JobRow.state == JobState.FAILED,
            JobRow.failure_dismissed.is_(True),
            JobRow.failure_kind == "auth",
            JobRow.finished_at < renewed,
        )
        role = db.scalar(select(AccountRow.role).where(AccountRow.id == caller.id))
        if role != Role.ADMIN:
            eligible = eligible.where(JobRow.requested_by == caller.id)
        failures = db.execute(eligible).all()
        if not failures:
            return {}
        dismissed = dismissed_download_tracks(db)
        return {
            source.locator: JobId(job_id)
            for target, job_id in failures
            if (source := targets[target]).track_id in dismissed
            and not source_is_held(db, source.kind, source.locator)
        }

    def retry_dismissed_in(
        self, db: Session, caller: Account, source: SourceRow, failed: JobId
    ) -> Job:
        """Queue this dismissed attempt again while the caller holds the writer lock."""
        if self.dismissed_retries_in(db, caller, [source]).get(source.locator) != failed:
            message = "This download can no longer be retried from this lookup."
            raise ConflictError(message)
        return queue_job_in(
            db,
            self._kind,
            download_target(SourceId(source.id)),
            _request(source),
            caller.id,
            self._clock,
            login_account=caller.id,
        )

    def start_for(self, account_id: AccountId, source_id: SourceId) -> Job | None:
        """Start downloading the Source for the policy, as `account_id`, even after a failure.

        As `start`, but a failed last download is tried again: the policy decides
        when that is due. A Source already downloaded, as one may be since the
        policy's snapshot, isn't downloaded again.
        """
        return self._start(account_id, source_id, by_policy=True)

    def served(self, source_id: SourceId) -> None:
        """Record that the Source's Download was served now, at most once a minute.

        It reads before it writes, so the many range requests of one play don't
        each take the write lock.
        """
        now = self._clock()
        due = (DownloadRow.last_served_at.is_(None)) | (
            DownloadRow.last_served_at <= now - SERVED_EVERY
        )
        mine = DownloadRow.source_id == source_id
        with self._units() as db:
            if db.scalar(select(DownloadRow.source_id).where(mine, due)) is None:
                return
        with self._units.begin() as db:
            db.execute(update(DownloadRow).where(mine, due).values(last_served_at=now))

    def start(self, caller: Account, source_id: SourceId) -> Job | None:
        """Start downloading the Source, or return the Job already doing it.

        The Job uses the caller's login on the site when it is valid. An
        *unavailable* Source, or one no plugin that is on downloads, isn't
        downloaded: the answer is `None`. When the last download failed, the
        answer is that Job: the household retries it, so playing a Track again
        and again doesn't ask the site again and again.
        """
        return self._start(caller.id, source_id, by_policy=False)

    def _start(
        self,
        account_id: AccountId,
        source_id: SourceId,
        *,
        by_policy: bool,
    ) -> Job | None:
        available = BILIBILI_SOURCE in self._plugins.available_keys().get(
            SOURCE_DOWNLOADER.name, []
        )
        with self._units.begin() as db:
            db.connection().exec_driver_sql("BEGIN IMMEDIATE")
            job, created = self._start_in(
                db, account_id, source_id, by_policy=by_policy, available=available
            )
        if created and job is not None:
            self._jobs.announce_queued(job.id)
        return job

    def _start_in(
        self,
        db: Session,
        account_id: AccountId,
        source_id: SourceId,
        *,
        by_policy: bool,
        available: bool,
    ) -> tuple[Job | None, bool]:
        row = db.get(SourceRow, source_id)
        if row is None or row.kind != BILIBILI_SOURCE:
            message = f"The Source {source_id} isn't one medleyplay downloads."
            raise NotFoundError(message)
        if (
            not available
            or row.state == SourceState.UNAVAILABLE
            or source_is_held(db, row.kind, row.locator)
        ):
            return None, False
        existing = db.get(DownloadRow, source_id)
        if existing is not None and (by_policy or _saved_on_disk(existing, self.folder)):
            return None, False
        target = download_target(source_id)
        latest = self._jobs.latest_in(db, DOWNLOAD_KIND, target)
        if (
            latest is not None
            and latest.state is JobState.FAILED
            and (not by_policy or latest.failure_kind in NO_AUTOMATIC_RETRY)
        ):
            return (None if by_policy else latest), False
        login = (
            account_id
            if self._linked.valid_saved_at_in(db, account_id, row.kind) is not None
            else None
        )
        return self._jobs.submit_in(
            db, self._kind, target, _request(row), account_id, login_account=login
        )

    def queue_new_in(self, db: Session, caller: Account, source: SourceRow) -> Job | None:
        """Queue audio for a newly inserted Source before its import commits."""
        if source.kind not in self._plugins.available_keys().get(SOURCE_DOWNLOADER.name, []):
            return None
        login = caller.id if self._linked.has_valid(caller.id, source.kind) else None
        return queue_job_in(
            db,
            self._kind,
            download_target(SourceId(source.id)),
            _request(source),
            caller.id,
            self._clock,
            login_account=login,
        )

    def active_in(self, db: Session, source: SourceId) -> Job | None:
        """Return the active Download Job without leaving the caller's transaction."""
        row = db.scalar(
            select(JobRow).where(
                JobRow.kind == DOWNLOAD_KIND,
                JobRow.target == download_target(source),
                JobRow.state.in_(ACTIVE_STATES),
            )
        )
        return None if row is None else to_job(row)

    def sweep(self) -> None:
        """Recover abandoned files at startup before uploads or Jobs can write."""
        if self.folder.is_symlink() or not self.folder.is_dir():
            return
        with self._units.begin() as db:
            sweep_download_files(db, self.folder)


def _request(source: SourceRow) -> DownloadSource:
    selection = video_selection(source.locator)
    return DownloadSource(
        site=source.kind,
        video=selection.video,
        part=None if selection.joined else selection.parts[0],
        parts=selection.parts if selection.joined else None,
        lane=JOIN_LANE if selection.joined and len(selection.parts) > 1 else None,
        quality=str((source.details or {}).get(QUALITY_DETAIL, BEST_QUALITY)),
        extensions=DOWNLOAD_EXTENSIONS,
        max_bytes=MAX_DOWNLOAD_BYTES,
    )


def _saved_on_disk(download: DownloadRow, folder: Path) -> bool:
    try:
        return stat.S_ISREG((folder / download.file_name).lstat().st_mode)
    except FileNotFoundError:
        return False


def _join_refusal(db: Session, source: SourceRow, data_dir: Path, *, starting: bool) -> str | None:
    source_id = SourceId(source.id)
    selection = video_selection(source.locator)
    multiple = len(selection.parts) > 1
    if db.get(DownloadRow, source_id) is not None:
        return "This joined album is already downloaded."
    if multiple and join_tools() is None:
        return "Joining several parts requires FFmpeg and ffprobe. Use Separate files instead."
    duration = db.get_one(TrackRow, source.track_id).duration_ms
    budget = DownloadBudget(
        estimate_of(source.details, duration), JOIN_SCRATCH_BYTES if multiple else 0
    )
    return limit_refusal(db, data_dir, source_id, budget.estimate) or disk_refusal(
        db, data_dir, source_id, budget, starting=starting
    )
