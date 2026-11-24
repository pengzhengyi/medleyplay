"""Downloads: starting the Job that downloads a site's Source, and recording what it made.

The program checks the file the plugin made, in the Job's folder; the completion
renames it into `downloads/` and records it, in the transaction that ends the
Job. A crash between the two leaves a file no row names, which the sweep at
startup removes, and the Job runs again.
"""

import stat
from datetime import timedelta
from functools import partial
from pathlib import Path, PurePosixPath
from typing import Final

from sqlalchemy import select, update
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application import Clock
from medleyplay.application.download_budgets import (
    DownloadBudget,
    disk_refusal,
    estimate_of,
    limit_refusal,
)
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
from medleyplay.domain.accounts import Account, AccountId
from medleyplay.domain.catalog import SourceId, SourceState
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
from medleyplay.domain.errors import ConflictError, NotFoundError
from medleyplay.domain.jobs import ACTIVE_STATES, Job, JobState
from medleyplay.domain.links import BILIBILI_SOURCE, joined_locator, video_selection
from medleyplay.download_limits import JOIN_SCRATCH_BYTES, MAX_DOWNLOAD_BYTES
from medleyplay.persistence.schema import DownloadRow, JobRow, SourceRow, TrackRow
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
        program="medleyplay.programs.download_source:DOWNLOAD_SOURCE",
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
    source = db.get(SourceRow, source_id)
    if source is None:
        return JobCompletion(failure=("refused", "The Source is no longer in the Library."))
    joined = video_selection(source.locator).joined
    existing = db.get(DownloadRow, source_id)
    if joined and existing is not None:
        return None
    if downloaded.gone or downloaded.file is None:
        source.state = SourceState.UNAVAILABLE
        return None
    if joined and (refusal := limit_refusal(db, data_dir, source_id, downloaded.size)):
        return JobCompletion(failure=("refused", refusal))
    if PurePosixPath(downloaded.file).name != downloaded.file:  # pragma: no cover
        raise ValueError(downloaded.file)
    name = download_name(source_id, downloaded.file)
    folder = data_dir / DOWNLOADS_FOLDER
    folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    made = jobs_dir / str(job.id) / DOWNLOAD_FOLDER / downloaded.file
    made.replace(folder / name)
    row = existing or DownloadRow(source_id=source_id)
    row.file_name = name
    row.quality = downloaded.quality
    row.backend = downloaded.backend
    row.size = downloaded.size
    row.downloaded_at = clock()
    db.add(row)
    if joined:
        source.details = {**(source.details or {}), JOIN_ESTIMATE_DETAIL: downloaded.size}
        if downloaded.duration_ms is not None:
            db.get_one(TrackRow, source.track_id).duration_ms = downloaded.duration_ms
    return None


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

    def start_for(self, account_id: AccountId, source_id: SourceId) -> Job | None:
        """Start downloading the Source for the policy, as `account_id`, even after a failure.

        As `start`, but a failed last download is tried again: the policy decides
        when that is due. A Source already downloaded, as one may be since the
        policy's snapshot, isn't downloaded again.
        """
        return self._start(account_id, source_id, retry_failed=True, skip_downloaded=True)

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
        return self._start(caller.id, source_id, retry_failed=False, skip_downloaded=False)

    def _start(
        self,
        account_id: AccountId,
        source_id: SourceId,
        *,
        retry_failed: bool,
        skip_downloaded: bool,
    ) -> Job | None:
        with self._units() as db:
            row = db.get(SourceRow, source_id)
            if row is None or row.kind != BILIBILI_SOURCE:
                message = f"The Source {source_id} isn't one medleyplay downloads."
                raise NotFoundError(message)
            if row.state == SourceState.UNAVAILABLE:
                return None
            selection = video_selection(row.locator)
            existing = (
                db.get(DownloadRow, source_id) if skip_downloaded or selection.joined else None
            )
            if existing is not None and (skip_downloaded or _saved_on_disk(existing, self.folder)):
                return None
            site = row.kind
            request = _request(row)
        if site not in self._plugins.available_keys().get(SOURCE_DOWNLOADER.name, []):
            return None
        target = download_target(source_id)
        latest = self._jobs.latest(DOWNLOAD_KIND, target)
        if not retry_failed and latest is not None and latest.state is JobState.FAILED:
            return latest
        login = account_id if self._linked.has_valid(account_id, site) else None
        return self._jobs.submit(self._kind, target, request, account_id, login_account=login)

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
        """Remove every file in `downloads/` that no Download names."""
        if not self.folder.is_dir():
            return
        with self._units() as db:
            named = set(db.scalars(select(DownloadRow.file_name)))
        for file in self.folder.iterdir():
            if file.name not in named:
                file.unlink(missing_ok=True)


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
