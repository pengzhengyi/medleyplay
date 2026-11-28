"""The Job runner: a thread in the server that starts Job processes and settles their outcomes.

The server is the only runner, so a Job left running at startup belongs to a
server that stopped; `start` recovers it before anything new starts.
"""

import contextlib
import fcntl
import os
import shutil
import threading
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from hashlib import sha256
from pathlib import Path
from typing import Any, Final, Protocol

from pydantic import ValidationError
from sqlalchemy import ColumnElement, and_, not_, or_, select, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from medleyplay import __version__
from medleyplay.application import Clock
from medleyplay.application.download_diagnostics import Receipt, append_receipt, prune_receipts
from medleyplay.application.download_holds import (
    DIRECT_ROUTE,
    HOLD_MESSAGE,
    UNCERTAIN_MESSAGE,
    classify_legacy_jobs,
    held_videos,
    hold_of,
    job_selection,
    provider_dispatch_exists,
    provider_jobs,
    provider_route,
    record_hold,
    recover_dispatches,
    release_dispatch,
    reserve_dispatch,
)
from medleyplay.application.events import Events
from medleyplay.application.jobs import AnyJobKind, Lane, to_job
from medleyplay.application.plugins import PluginService
from medleyplay.domain.accounts import AccountId
from medleyplay.domain.ai import redact_key
from medleyplay.domain.download_holds import DownloadSelection, HoldReason
from medleyplay.domain.downloads import DOWNLOAD_KIND
from medleyplay.domain.errors import KeychainUnavailableError
from medleyplay.domain.jobs import JobId, JobState, Progress
from medleyplay.domain.linked_accounts import redact
from medleyplay.download_receipts import (
    DownloadEvent,
    DownloadReason,
    DownloadRoute,
    DownloadStage,
    reason_for,
    reason_message,
)
from medleyplay.persistence.schema import JobRow, ProviderDispatchRow
from medleyplay.plugin_api import API_VERSION, AiEndpoint
from medleyplay.plugin_api.image_search import TAVILY
from medleyplay.plugin_api.progress import MAX_MESSAGE as MAX_PROGRESS_MESSAGE
from medleyplay.plugin_host.job_wire import (
    FROM_JOB,
    RESULT_FILE,
    DownloadProgress,
    FromJob,
    JobFailed,
    JobFinished,
    JobProgress,
    JobStart,
    KeyOutcome,
)
from medleyplay.plugin_host.loader import BUILT_IN_PLUGINS
from medleyplay.plugin_host.process import (
    ChildExitedError,
    ChildProcess,
    ChildTimeoutError,
    HostCommand,
    kill_group,
)
from medleyplay.proxy_redaction import redact_proxy

MAX_RUNNING: Final = 2
POLL: Final = timedelta(seconds=1)
FIRST_RETRY: Final = timedelta(seconds=30)
NETWORK_RETRY: Final = timedelta(minutes=1)
"""How long a Job waits after a network failure, or a Keychain that didn't answer."""
MAX_INTERRUPTIONS: Final = 3
RECEIPT_SWEEP_INTERVAL: Final = timedelta(hours=1)
JOB_MEMORY_LIMIT: Final = 2 * 1024**3
LOCK_FILE: Final = "lock"
LOGIN_FILE: Final = "login.txt"
_NEW_PRIVATE: Final = os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW


class Lent(Protocol):
    """A copy of a login lent to one Job, and the revision it was copied at."""

    @property
    def text(self) -> str: ...  # noqa: D102
    @property
    def revision(self) -> int: ...  # noqa: D102


class Logins(Protocol):
    """Where the runner borrows Accounts' logins for Jobs, as `LinkedAccountService` provides."""

    def lend(self, account_id: AccountId, site: str) -> Lent | None:
        """Return a copy of the Account's valid login on `site`, or `None`."""
        ...

    def refused(self, account_id: AccountId, site: str, revision: int) -> None:
        """Mark the login refused, unless it was saved again since `revision`."""
        ...

    def refused_in(self, db: Session, account_id: AccountId, site: str, revision: int) -> None:
        """Mark the lent login refused in the caller's transaction."""
        ...


class Proxies(Protocol):
    """Where the runner finds a site's proxy for a Job, as `ProxyService` provides."""

    def current(self, site: str) -> str | None:
        """Return the URL calls for `site` go through, or `None` when no proxy is set."""
        ...


class AiProviders(Protocol):
    """Where the runner finds the AI providers for a Job, as `AiService` provides."""

    def endpoints(self) -> tuple[AiEndpoint, ...]:
        """Return the providers in order with their keys, or none when none is set up."""
        ...


@dataclass(frozen=True)
class JobProcesses:
    """How to start Job processes, and where their plugins come from."""

    command: HostCommand = field(default_factory=HostCommand)
    package: str = BUILT_IN_PLUGINS


@dataclass(frozen=True)
class _Fault:
    """The Job process failed without saying why: it hung, grew too large, or exited."""

    message: str


@dataclass(frozen=True)
class _Interrupted:
    """The server interrupted the Job."""


type _Outcome = JobFinished | JobFailed | _Fault | _Interrupted


class _ProviderInterruptedError(Exception):
    """A provider Job cannot publish after it was interrupted."""


@dataclass(frozen=True)
class _Login:
    account_id: AccountId
    site: str
    lent: Lent


@dataclass
class _Running:
    job_id: JobId
    kind: AnyJobKind
    work_dir: Path
    process: ChildProcess[FromJob]
    login: _Login | None = None
    proxy: str | None = None
    lane: str | None = None
    ai: tuple[AiEndpoint, ...] = ()
    tavily_key: str | None = field(default=None, repr=False)
    thread: threading.Thread | None = None
    held: bool = False
    """Stopped because the Mode went Offline."""
    done: bool = False
    """Its outcome has been read or the process stopped responding."""
    provider: DownloadSelection | None = None
    route: str | None = None
    plugins: tuple[str, ...] = ()
    progress_key: tuple[DownloadStage, int | None] | None = None
    last_progress_at: float = 0.0

    def redact(self, message: str) -> str:
        if self.tavily_key and self.tavily_key in message:
            return "Tavily search failed."
        text = redact(message, self.login.lent.text if self.login else None)
        for endpoint in self.ai:
            text = redact_key(text, endpoint.key)
        return redact_proxy(text, self.proxy)


class JobRunner:
    """Start queued Jobs in their own processes, at most `max_running` at once."""

    def __init__(  # noqa: PLR0913 -- the collaborators, then settings with defaults
        self,
        units: sessionmaker[Session],
        clock: Clock,
        kinds: Mapping[str, AnyJobKind],
        plugins: PluginService,
        jobs_dir: Path,
        *,
        processes: JobProcesses = JobProcesses(),
        max_running: int = MAX_RUNNING,
        poll: timedelta = POLL,
        online: Callable[[], bool] = lambda: True,
        memory_limit: int = JOB_MEMORY_LIMIT,
        logins: Logins | None = None,
        proxies: Proxies | None = None,
        ai: AiProviders | None = None,
        tavily_key: Callable[[], str | None] | None = None,
        events: Events | None = None,
        network_failed: Callable[[], None] | None = None,
    ) -> None:
        """Create a runner keeping Jobs' working folders in `jobs_dir`."""
        self._units = units
        self._clock = clock
        self._kinds = kinds
        self._plugins = plugins
        self._jobs_dir = jobs_dir
        self._processes = processes
        self._max_running = max_running
        self._poll = poll
        self._online = online
        self._memory_limit = memory_limit
        self._logins = logins
        self._proxies = proxies
        self._ai = ai
        self._tavily_key = tavily_key
        self._events = events
        self._network_failed = network_failed
        self._network_kinds = tuple(name for name, kind in kinds.items() if kind.needs_network)
        self._lock = threading.Lock()
        self._running: dict[JobId, _Running] = {}
        self._progress: dict[JobId, Progress] = {}
        self._lane_opens: dict[tuple[str, str], datetime] = {}
        """When each lane may start its next Job: after the spacing from its last."""
        self._wake = threading.Event()
        self._stopping = threading.Event()
        self._loop_thread: threading.Thread | None = None

    def start(self) -> None:
        """Recover Jobs a stopped server left running, then start running Jobs."""
        self._jobs_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.recover()
        self._loop_thread = threading.Thread(target=self._loop, name="job-runner", daemon=True)
        self._loop_thread.start()

    def stop(self) -> None:
        """Stop starting Jobs and settle the ones in progress."""
        self._stopping.set()
        self._wake.set()
        if self._loop_thread is not None:
            self._loop_thread.join()
        with self._lock:
            running = list(self._running.values())
        for job in running:
            job.process.stop()
        for job in running:
            if job.thread is not None:
                job.thread.join()

    def wake(self) -> None:
        """Look for a Job to start now, rather than at the next poll."""
        self._wake.set()

    def follow_mode(self) -> None:
        """Stop network Jobs when the Mode goes Offline.

        A dispatched provider Job needs a Hold before any overlapping request can start.
        """
        if not self._online():
            with self._lock:
                held = [
                    job
                    for job in self._running.values()
                    if job.kind.needs_network and (not job.done or job.provider is not None)
                ]
                for job in held:
                    job.held = True
            for job in held:
                if not job.done:
                    job.process.kill()
        self._wake.set()

    def kill(self, job_id: JobId) -> None:
        """Kill a running Job's process group."""
        with self._lock:
            job = self._running.get(job_id)
        if job is not None:
            job.process.kill()

    def progress(self, job_id: JobId) -> Progress | None:
        """Return a running Job's latest progress."""
        with self._lock:
            return self._progress.get(job_id)

    def recover(self) -> None:
        """Recover interrupted Jobs before claiming new work.

        Keep the provider lane reserved if the previous writer might still be running.
        """
        with self._units() as db:
            running = db.scalars(select(JobRow).where(JobRow.state == JobState.RUNNING))
            stale = [(row.id, row.pid, row.interruptions) for row in running]
            dispatched = set(db.scalars(select(ProviderDispatchRow.job_id)))
        stopped = self._stopped_dispatches(dispatched)
        for job_id, pid, _ in stale:
            if job_id in dispatched:
                continue
            if pid is not None and lock_is_held(self._jobs_dir / str(job_id) / LOCK_FILE):
                kill_group(pid)
        with self._units.begin() as db:
            db.connection().exec_driver_sql("BEGIN IMMEDIATE")
            self._recover_provider_in(db, stopped)
        for job_id, _, interruptions in stale:
            if interruptions + 1 >= MAX_INTERRUPTIONS:
                message = f"A server restart interrupted it {interruptions + 1} times."
                self._set(JobId(job_id), JobState.FAILED, failure=("program", message))
            else:
                self._set(JobId(job_id), JobState.QUEUED, interruptions=interruptions + 1)
        retained = {str(job_id) for job_id in dispatched - stopped}
        for entry in self._jobs_dir.iterdir():
            if entry.name not in retained:
                shutil.rmtree(entry, ignore_errors=True)

    def _stopped_dispatches(self, dispatched: set[int | None]) -> set[int]:
        stopped: set[int] = set()
        for job_id in dispatched:
            if job_id is None:
                continue
            lock = self._jobs_dir / str(job_id) / LOCK_FILE
            if lock.is_file() and not lock_is_held(lock):
                stopped.add(job_id)
        return stopped

    def _recover_provider_in(self, db: Session, stopped: set[int]) -> None:
        now = self._clock()
        for job in recover_dispatches(db, stopped, now):
            if job.kind == DOWNLOAD_KIND:
                append_receipt(
                    db,
                    job.id,
                    now,
                    Receipt(
                        DownloadEvent.FAILED,
                        attempt=job.provider_attempts,
                        reason=DownloadReason.ATTEMPT_UNCERTAIN,
                    ),
                )
        classify_legacy_jobs(db, now)
        prune_receipts(db, now)

    def _loop(self) -> None:
        sweep_at = self._clock() + RECEIPT_SWEEP_INTERVAL
        while not self._stopping.is_set():
            now = self._clock()
            if now >= sweep_at:
                self._sweep_receipts(now)
                sweep_at = now + RECEIPT_SWEEP_INTERVAL
            self._promote_waiting()
            while self._has_room() and not self._stopping.is_set():
                if not self._start_next():
                    break
            self._wake.wait(self._poll.total_seconds())
            self._wake.clear()

    def _sweep_receipts(self, now: datetime) -> None:
        with contextlib.suppress(SQLAlchemyError), self._units.begin() as db:
            prune_receipts(db, now)

    def _has_room(self) -> bool:
        with self._lock:
            return len(self._running) < self._max_running

    def _promote_waiting(self) -> None:
        if not self._online():
            return
        with self._units.begin() as db:
            due = (JobRow.state == JobState.WAITING) & _due(self._clock())
            promoted = list(db.scalars(select(JobRow.id).where(due)))
            db.execute(
                update(JobRow).where(JobRow.id.in_(promoted), due).values(state=JobState.QUEUED)
            )
        for job_id in promoted:
            self._publish(JobId(job_id))

    def _start_next(self) -> bool:
        with self._units.begin() as db:
            db.connection().exec_driver_sql("BEGIN IMMEDIATE")
            now = self._clock()
            ready = (JobRow.state == JobState.QUEUED) & _due(now)
            if not self._online():
                ready &= JobRow.kind.not_in(self._network_kinds)
            if (closed := self._closed_lanes(now)) is not None:
                ready &= not_(closed)
            if provider_dispatch_exists(db):
                ready &= not_(provider_jobs())
            row = db.scalar(select(JobRow).where(ready).order_by(JobRow.id).limit(1))
            if row is None:
                return False
            claimed = db.connection().execute(
                update(JobRow)
                .where(JobRow.id == row.id, JobRow.state == JobState.QUEUED)
                .values(state=JobState.RUNNING, started_at=now, finished_at=None)
            )
            job_id, kind_name, request = JobId(row.id), row.kind, row.request
            # Only the Account that asked lends its login: once it is deleted, its id
            # may be taken by a new Account, whose login the Job was never meant to have.
            login_account = (
                row.login_account_id if row.login_account_id == row.requested_by else None
            )
            kind = self._kinds.get(kind_name)
            refusal = None
            if claimed.rowcount == 1 and kind is not None:
                refusal = self._turned_away(db, kind, request)
                if refusal is not None:
                    self._set_in(db, job_id, JobState.FAILED, failure=("refused", refusal))
        if claimed.rowcount != 1:
            return True
        self._publish(job_id)
        if kind is None:
            message = f"This server no longer runs Jobs of the kind {kind_name!r}."
            self._settle_failure(job_id, "program", message)
            return True
        if refusal is None:
            self._launch(
                job_id, kind, request, None if login_account is None else AccountId(login_account)
            )
        return True

    def _closed_lanes(self, now: datetime) -> ColumnElement[bool] | None:
        """Return the Jobs that can't start: those of a lane that is busy or still spacing."""
        with self._lock:
            closed = {
                _lane_key(running.kind, running.lane)
                for running in self._running.values()
                if running.lane is not None
            }
            closed |= {lane for lane, opens in self._lane_opens.items() if opens > now}
        clauses = []
        for name, kind in self._kinds.items():
            lanes = sorted(lane for lane in kind.lanes if _lane_key(kind, lane) in closed)
            if kind.lane_field is not None and lanes:
                request = JobRow.__table__.c.request[kind.lane_field].as_string()
                clauses.append(and_(JobRow.kind == name, request.is_not(None), request.in_(lanes)))
        return or_(*clauses) if clauses else None

    def _turned_away(self, db: Session, kind: AnyJobKind, request: object) -> str | None:
        """Return why the Job can't start, or `None`: its kind's reason, or a lane it lacks."""
        lane = _lane_name(kind, request)
        if (
            kind.lane_field is not None
            and lane not in kind.lanes
            and (lane is not None or not kind.lane_optional)
        ):
            return f"This server no longer runs {lane!r} for {kind.name}."
        return None if kind.refuse_start is None else kind.refuse_start(db, request)

    def _launch(
        self, job_id: JobId, kind: AnyJobKind, request: object, login_account: AccountId | None
    ) -> None:
        work_dir = self._jobs_dir / str(job_id)
        work_dir.mkdir(mode=0o700, exist_ok=True)
        lane = _lane_name(kind, request)
        lane_rules = kind.lanes.get(lane) if lane is not None else None
        selection = job_selection(kind.name, request) if isinstance(request, dict) else None
        with self._units() as db:
            route = provider_route(db, selection.site) if selection is not None else None
        try:
            login = self._lend(kind, login_account, work_dir)
            proxy = self._proxy(kind, lane_rules)
            ai = self._ai_providers(lane_rules)
            plugins, tavily_key = self._job_plugins(kind)
            process = (
                self._spawn(work_dir, bounded_output=True)
                if kind.name == DOWNLOAD_KIND
                else self._spawn(work_dir)
            )
        except KeychainUnavailableError as error:
            # The Keychain can be locked or prompting; it usually answers again soon.
            shutil.rmtree(work_dir, ignore_errors=True)
            what = (
                "key"
                if kind.lends_tavily or (lane_rules and lane_rules.lends_ai)
                else "login or proxy"
            )
            failure = ("keychain", f"Its {what} couldn't be read: {error}")
            self._set(
                job_id,
                JobState.WAITING,
                failure=failure,
                not_before=self._clock() + NETWORK_RETRY,
            )
            return
        except OSError as error:
            self._settle_failure(job_id, "program", f"Its process didn't start: {error}")
            shutil.rmtree(work_dir, ignore_errors=True)
            return
        running = _Running(
            job_id,
            kind,
            work_dir,
            process,
            login,
            proxy,
            lane,
            ai,
            tavily_key,
            route=route,
            plugins=plugins,
        )
        with self._lock:
            self._running[job_id] = running
        # The Mode may have gone Offline since the claim, before `follow_mode` could
        # see this Job: checked after registering, one of the two stops it.
        if kind.needs_network and not self._online():
            with self._lock:
                running.held = True
        # A cancel that landed while the process was starting found nothing to kill.
        if running.held or not self._set_pid(job_id, process.pid):
            process.kill()
        else:
            self._send_start(
                running,
                JobStart(
                    package=self._processes.package,
                    plugins=plugins,
                    program=kind.program,
                    request=request,  # type: ignore[arg-type] # a JSON column holds JSON
                    work_dir=str(work_dir),
                    login=str(work_dir / LOGIN_FILE) if login else None,
                    proxy=proxy,
                    ai=ai,
                    tavily_key=tavily_key,
                ),
                selection,
            )
        running.thread = threading.Thread(target=self._supervise, args=(running,), daemon=True)
        running.thread.start()

    def _send_start(
        self, running: _Running, start: JobStart, selection: DownloadSelection | None
    ) -> None:
        if selection is not None:
            backend = _backend_signature(start)
            videos = self._reserve_provider(running, selection, backend)
            if videos is None:
                running.process.kill()
                self._publish(running.job_id)
                return
            running.provider = selection
            start = start.model_copy(update={"held_videos": videos})
            if not self._may_dispatch(running):
                running.process.kill()
                return
        with contextlib.suppress(ChildExitedError):
            running.process.send(start)

    def _may_dispatch(self, running: _Running) -> bool:
        if running.held or self._stopping.is_set() or not self._online():
            return False
        with self._units() as db:
            return _get(db, running.job_id).state == JobState.RUNNING and not self._route_changed(
                running, db
            )

    def _reserve_provider(
        self, running: _Running, selection: DownloadSelection, backend: str
    ) -> tuple[str, ...] | None:
        job_id = running.job_id
        with self._units.begin() as db:
            db.connection().exec_driver_sql("BEGIN IMMEDIATE")
            row = _get(db, job_id)
            if row.state != JobState.RUNNING:
                return None
            if hold_of(db, selection) is not None:
                reason = "held" if running.kind.name == DOWNLOAD_KIND else "refused"
                self._set_in(db, job_id, JobState.FAILED, failure=(reason, HOLD_MESSAGE))
                return None
            if refusal := _profile_refusal(
                running, row, provider_route(db, selection.site), backend
            ):
                self._set_in(db, job_id, JobState.FAILED, failure=refusal)
                return None
            videos = held_videos(db, selection.site) if selection.short else ()
            if videos is None:
                message = "Short links are unavailable. Use the full video link."
                self._set_in(db, job_id, JobState.FAILED, failure=("refused", message))
                return None
            if not reserve_dispatch(db, selection, job_id):
                self._set_in(db, job_id, JobState.QUEUED)
                return None
            row.provider_attempts = (row.provider_attempts or 0) + 1
            row.provider_route = running.route
            row.provider_backend = backend
            if row.kind == DOWNLOAD_KIND:
                append_receipt(
                    db,
                    row.id,
                    self._clock(),
                    Receipt(
                        DownloadEvent.DISPATCHED,
                        attempt=row.provider_attempts,
                        route=DownloadRoute.DIRECT
                        if running.proxy is None
                        else DownloadRoute.SITE_PROXY,
                    ),
                )
            return videos

    def _job_plugins(self, kind: AnyJobKind) -> tuple[tuple[str, ...], str | None]:
        plugins = self._plugins.plugins_for(kind.points)
        if not kind.lends_tavily:
            return plugins, None
        if TAVILY not in plugins:
            return (), None
        return (TAVILY,), self._tavily_key() if self._tavily_key else None

    def _proxy(self, kind: AnyJobKind, lane: Lane | None) -> str | None:
        # The Job keeps the proxy it starts with; it goes to its process, never to disk.
        site = kind.proxy_site if lane is None else lane.proxy_site
        if site is None or self._proxies is None:
            return None
        return self._proxies.current(site)

    def _ai_providers(self, lane: Lane | None) -> tuple[AiEndpoint, ...]:
        # The Job keeps the providers it starts with; their keys go to its process, never to disk.
        if lane is None or not lane.lends_ai or self._ai is None:
            return ()
        return self._ai.endpoints()

    def _lend(
        self, kind: AnyJobKind, account_id: AccountId | None, work_dir: Path
    ) -> _Login | None:
        # The copy is readable by its owner alone, and goes with the working folder.
        if kind.login_site is None or account_id is None or self._logins is None:
            return None
        lent = self._logins.lend(account_id, kind.login_site)
        if lent is None:
            return None
        descriptor = os.open(work_dir / LOGIN_FILE, _NEW_PRIVATE, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as file:
            file.write(lent.text)
        return _Login(account_id, kind.login_site, lent)

    def _spawn(self, work_dir: Path, *, bounded_output: bool = False) -> ChildProcess[FromJob]:
        # The lock is taken before the process starts and handed to it, so it is
        # held from the first instant the process exists until its last copy closes.
        lock = os.open(work_dir / LOCK_FILE, os.O_CREAT | os.O_RDWR, 0o600)
        try:
            fcntl.flock(lock, fcntl.LOCK_EX)
            return ChildProcess(
                self._processes.command,
                FROM_JOB,
                args=("job",),
                pass_fds=(lock,),
                bounded_output=bounded_output,
            )
        finally:
            os.close(lock)

    def _supervise(self, running: _Running) -> None:
        outcome = self._watch(running)
        with self._lock:
            running.done = True
            if running.lane is not None:
                spacing = running.kind.lanes[running.lane].spacing
                self._lane_opens[_lane_key(running.kind, running.lane)] = self._clock() + spacing
        if isinstance(outcome, JobFinished | JobFailed):
            running.process.finish()
        else:
            running.process.kill()
        try:
            self._settle(running, outcome)
        finally:
            shutil.rmtree(running.work_dir, ignore_errors=True)
            with self._lock:
                self._running.pop(running.job_id, None)
                self._progress.pop(running.job_id, None)
            self._wake.set()

    def _watch(self, running: _Running) -> _Outcome:
        idle = running.kind.idle_timeout
        while True:
            try:
                message = running.process.receive(idle.total_seconds())
            except ChildTimeoutError:
                return _Fault(f"It reported nothing for {idle}.")
            except ChildExitedError:
                if self._stopping.is_set():
                    return _Interrupted()
                return _Fault("Its process exited without an outcome.")
            if isinstance(message, JobFinished | JobFailed):
                return message
            if message.peak_memory > self._memory_limit:
                return _Fault(f"It used {message.peak_memory // 1024**2} MiB of memory.")
            if running.kind.name == DOWNLOAD_KIND:
                if isinstance(message, DownloadProgress):
                    self._download_progress(running, message)
            elif isinstance(message, JobProgress):
                shown = running.redact(message.message)[:MAX_PROGRESS_MESSAGE]
                with self._lock:
                    self._progress[running.job_id] = Progress(message.fraction, shown)
                self._publish(running.job_id, progress=True)

    def _download_progress(self, running: _Running, frame: DownloadProgress) -> None:
        selection = running.provider
        if selection is None or (frame.part is not None and frame.part not in selection.parts):
            return
        key = (frame.stage, frame.part)
        changed = key != running.progress_key
        now = time.monotonic()
        if not changed and now - running.last_progress_at < 1:
            return
        running.progress_key, running.last_progress_at = key, now
        if changed:
            self._record_download_stage(running.job_id, frame)
        with self._lock:
            self._progress[running.job_id] = _safe_download_progress(frame)
        self._publish(running.job_id, progress=True)

    def _record_download_stage(self, job_id: JobId, frame: DownloadProgress) -> None:
        try:
            with self._units.begin() as db:
                db.connection().exec_driver_sql("BEGIN IMMEDIATE")
                row = _get(db, job_id)
                if row.state == JobState.RUNNING and row.provider_attempts:
                    append_receipt(
                        db,
                        job_id,
                        self._clock(),
                        Receipt(
                            DownloadEvent.STAGE,
                            attempt=row.provider_attempts,
                            stage=frame.stage,
                            part=frame.part,
                        ),
                    )
        except SQLAlchemyError:
            return

    def _settle(self, running: _Running, outcome: _Outcome) -> None:
        outcome = (
            _safe_download_outcome(running, outcome)
            if running.kind.name == DOWNLOAD_KIND
            else _redacted(running, outcome)
        )
        if running.provider is not None:
            self._settle_provider(running, outcome, running.provider)
        else:
            self._settle_standard(running, outcome)

    def _settle_standard(self, running: _Running, outcome: _Outcome) -> None:
        if running.held and not isinstance(outcome, JobFinished):
            self._set(running.job_id, JobState.QUEUED)
            return
        login, refused = running.login, isinstance(outcome, JobFailed) and outcome.kind == "auth"
        if refused and login is not None and self._logins is not None:
            self._logins.refused(login.account_id, login.site, login.lent.revision)
        match outcome:
            case JobFinished(outcomes=outcomes):
                self._plugins.record_outcomes(outcomes)
                self._complete(running)
            case JobFailed(kind="network", message=message, outcomes=outcomes):
                self._plugins.record_outcomes(outcomes)
                not_before = self._clock() + NETWORK_RETRY
                self._set(
                    running.job_id,
                    JobState.WAITING,
                    failure=("network", message),
                    not_before=not_before,
                )
                if self._network_failed is not None:
                    self._network_failed()
            case JobFailed(kind="plugin", message=message, outcomes=outcomes):
                self._plugins.record_outcomes(outcomes)
                self._retry_or_fail(running, message)
            case JobFailed(kind=kind, message=message, outcomes=outcomes):
                self._plugins.record_outcomes(outcomes)
                self._fail(running, kind, message)
            case _Fault(message=message):
                self._retry_or_fail(running, message)
            case _Interrupted():
                self._set(running.job_id, JobState.QUEUED)

    def _settle_provider(
        self, running: _Running, outcome: _Outcome, selection: DownloadSelection
    ) -> None:
        if isinstance(outcome, JobFinished) and not self._provider_interrupted(running):
            if self._complete(running):
                self._plugins.record_outcomes(outcome.outcomes)
        else:
            self._commit_provider_failure(running, outcome, selection)

    def _provider_interrupted(self, running: _Running) -> bool:
        return running.held or self._stopping.is_set() or not self._online()

    def _route_changed(self, running: _Running, db: Session) -> bool:
        return (
            running.provider is not None
            and provider_route(db, running.provider.site) != running.route
        )

    def _commit_provider_failure(
        self, running: _Running, outcome: _Outcome, selection: DownloadSelection
    ) -> None:
        others: Sequence[JobId] = ()
        with self._units.begin() as db:
            db.connection().exec_driver_sql("BEGIN IMMEDIATE")
            row = _get(db, running.job_id)
            if row.state != JobState.RUNNING:
                release_dispatch(db, selection.site, running.job_id)
                return
            if self._route_changed(running, db):
                outcome = _Interrupted()
            state, kind, message, retry_time = self._provider_disposition(running, outcome, row)
            is_download = row.kind == DOWNLOAD_KIND
            evidence = (
                _download_failure_receipt(row, outcome, state, kind, retry_time)
                if is_download
                else None
            )
            self._set_in(
                db,
                running.job_id,
                state,
                failure=(kind, message),
                not_before=retry_time,
                evidence=evidence,
            )
            if kind == "refused" and not is_download:
                _record_provider_hold(db, selection, outcome, HoldReason.REFUSED, row)
            elif kind in HoldReason:
                _record_provider_hold(db, selection, outcome, HoldReason(kind), row)
            if state is JobState.FAILED and running.kind.on_failure is not None:
                db.refresh(row)
                reported_kind = "refused" if kind == HoldReason.REFUSED else kind
                others = running.kind.on_failure(db, to_job(row), reported_kind, message)
            if kind == "auth":
                self._refuse_login_in(db, running, row)
            release_dispatch(db, selection.site, running.job_id)
        if isinstance(outcome, JobFailed) and kind != HoldReason.UNCERTAIN:
            self._plugins.record_outcomes(outcome.outcomes)
        if state is JobState.WAITING and self._network_failed is not None:
            self._network_failed()
        for job_id in (*others, running.job_id):
            self._publish(job_id)

    def _refuse_login_in(self, db: Session, running: _Running, row: JobRow) -> None:
        login = running.login
        if login is not None and self._logins is not None and row.requested_by == login.account_id:
            self._logins.refused_in(db, login.account_id, login.site, login.lent.revision)

    def _provider_disposition(
        self, running: _Running, outcome: _Outcome, row: JobRow
    ) -> tuple[JobState, str, str, datetime | None]:
        if self._provider_interrupted(running) or not isinstance(outcome, JobFailed):
            return JobState.FAILED, HoldReason.UNCERTAIN, UNCERTAIN_MESSAGE, None
        if outcome.kind != "network":
            return JobState.FAILED, outcome.kind, outcome.message, None
        attempts = row.provider_attempts or 0
        if attempts >= running.kind.max_attempts:
            return JobState.FAILED, "retry_exhausted", "Download retry limit reached.", None
        delay = NETWORK_RETRY * max(1, attempts)
        return JobState.WAITING, outcome.kind, outcome.message, self._clock() + delay

    def _complete(self, running: _Running) -> bool:
        kind = running.kind
        try:
            text = (running.work_dir / RESULT_FILE).read_text(encoding="utf-8")
            result = kind.result.model_validate_json(text)
        except (OSError, UnicodeError, ValidationError) as error:
            self._reject_result(running, f"Its result is unreadable: {error}")
            return False
        queued: tuple[JobId, ...] = ()
        try:
            with self._units.begin() as db:
                if running.provider is not None:
                    db.connection().exec_driver_sql("BEGIN IMMEDIATE")
                    self._require_provider_current(running, db)
                    release_dispatch(db, running.provider.site, running.job_id)
                changed = self._set_in(db, running.job_id, JobState.SUCCEEDED)
                if changed:
                    row = _get(db, running.job_id)
                    completed = kind.complete(db, to_job(row), result)
                    if completed is not None:
                        queued = completed.queued
                        if completed.failure is not None:
                            row.state = JobState.FAILED
                            row.failure_kind, row.failure_message = completed.failure
                    row.finished_at = self._clock()
                    self._record_completion(
                        db,
                        row,
                        row.finished_at,
                        completed.diagnostic_reason if completed is not None else None,
                    )
        except _ProviderInterruptedError:
            if running.provider is not None:
                self._commit_provider_failure(running, _Interrupted(), running.provider)
            return False
        except Exception as error:  # noqa: BLE001 -- a failed completion fails its Job
            message = f"Its completion failed: {type(error).__name__}: {error}"
            self._reject_result(running, message, confirmed=not isinstance(error, SQLAlchemyError))
            return False
        self._publish(running.job_id)
        for job_id in queued:
            self._publish(job_id)
        return changed

    def _record_completion(
        self, db: Session, row: JobRow, now: datetime, completion_reason: DownloadReason | None
    ) -> None:
        if row.kind == DOWNLOAD_KIND:
            reason = reason_for(row.failure_kind)
            row.failure_message = reason_message(reason)
            append_receipt(
                db,
                row.id,
                now,
                Receipt(
                    DownloadEvent(row.state),
                    attempt=row.provider_attempts or None,
                    reason=reason or completion_reason,
                ),
            )

    def _require_provider_current(self, running: _Running, db: Session) -> None:
        if self._provider_interrupted(running) or self._route_changed(running, db):
            raise _ProviderInterruptedError

    def _reject_result(self, running: _Running, message: str, *, confirmed: bool = False) -> None:
        if running.provider is None:
            self._settle_failure(running.job_id, "program", message)
            return
        outcome = (
            JobFailed(kind="program", message=running.redact(message), peak_memory=0)
            if confirmed
            else _Fault(message)
        )
        self._commit_provider_failure(running, outcome, running.provider)

    def _retry_or_fail(self, running: _Running, message: str) -> None:
        with self._units() as db:
            attempts = _get(db, running.job_id).attempts + 1
        if attempts >= running.kind.max_attempts:
            self._set(
                running.job_id, JobState.FAILED, failure=("plugin", message), attempts=attempts
            )
            return
        delay = FIRST_RETRY * 2 ** (attempts - 1)
        self._set(
            running.job_id,
            JobState.QUEUED,
            failure=("plugin", message),
            attempts=attempts,
            not_before=self._clock() + delay,
        )

    def _fail(self, running: _Running, kind: str, message: str) -> None:
        """Fail the Job for the program's own reason; its kind reacts in the same transaction."""
        others: Sequence[JobId] = ()
        try:
            with self._units.begin() as db:
                changed = self._set_in(db, running.job_id, JobState.FAILED, failure=(kind, message))
                if changed and running.kind.on_failure is not None:
                    job = to_job(_get(db, running.job_id))
                    others = running.kind.on_failure(db, job, kind, message)
        except Exception as error:  # noqa: BLE001 -- a kind's reaction can't leave the Job running
            message = f"{message} (Its failure could not be recorded: {type(error).__name__}.)"
            self._settle_failure(running.job_id, kind, message)
            return
        if changed:
            self._publish(running.job_id)
        for other in others:
            self._publish(other)

    def _settle_failure(self, job_id: JobId, kind: str, message: str) -> None:
        self._set(job_id, JobState.FAILED, failure=(kind, message))

    def _set_pid(self, job_id: JobId, pid: int) -> bool:
        """Record the Job's process; return whether the Job is still running."""
        with self._units.begin() as db:
            recorded = db.connection().execute(
                update(JobRow)
                .where(JobRow.id == job_id, JobRow.state == JobState.RUNNING)
                .values(pid=pid)
            )
        return recorded.rowcount == 1

    def _set(self, job_id: JobId, state: JobState, **changes: Any) -> bool:  # noqa: ANN401 -- column values
        with self._units.begin() as db:
            changed = self._set_in(db, job_id, state, **changes)
        if changed:
            self._publish(job_id)
        return changed

    def _publish(self, job_id: JobId, *, progress: bool = False) -> None:
        if self._events is not None:
            self._events.publish(job_id, progress=progress)

    def _set_in(
        self,
        db: Session,
        job_id: JobId,
        state: JobState,
        *,
        failure: tuple[str, str] | None = None,
        evidence: Receipt | None = None,
        **changes: Any,  # noqa: ANN401 -- column values
    ) -> bool:
        # Only a running Job moves on; a cancel that got there first wins.
        values: dict[str, Any] = {"state": state, "pid": None, **changes}
        is_download = _get(db, job_id).kind == DOWNLOAD_KIND
        if failure is not None:
            reason = reason_for(failure[0])
            public = reason_message(reason, evidence.http_status if evidence else None)
            values["failure_kind"] = reason if is_download else failure[0]
            values["failure_message"] = public if is_download else failure[1][:2048]
            if is_download:
                values["provider_http_status"] = evidence.http_status if evidence else None
        elif state is JobState.SUCCEEDED:
            values["failure_kind"], values["failure_message"] = None, ""
            if is_download:
                values["provider_http_status"] = None
        if not state.is_active:
            values["finished_at"] = self._clock()
        changed = db.connection().execute(
            update(JobRow)
            .where(JobRow.id == job_id, JobRow.state == JobState.RUNNING)
            .values(**values)
        )
        if changed.rowcount != 1:
            return False
        if is_download and state in {JobState.WAITING, JobState.FAILED}:
            receipt = evidence or Receipt(
                DownloadEvent(state),
                reason=reason_for(failure[0]) if failure else None,
                retry_at=changes.get("not_before"),
            )
            append_receipt(db, job_id, self._clock(), receipt)
        return True


def lock_is_held(path: Path) -> bool:
    """Return whether some process holds the lock on `path`; a missing file is not held."""
    try:
        lock = os.open(path, os.O_RDWR)
    except FileNotFoundError:
        return False
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        return True
    finally:
        os.close(lock)
    return False


def _backend_signature(start: JobStart) -> str:
    identity = (__version__, API_VERSION, start.package, start.program, start.plugins)
    return sha256(repr(identity).encode()).hexdigest()


def _safe_download_progress(frame: DownloadProgress) -> Progress:
    labels = {
        DownloadStage.RESOLVE: "Preparing download",
        DownloadStage.TRANSFER: "Downloading",
        DownloadStage.JOIN: "Joining",
        DownloadStage.VALIDATE: "Checking audio",
    }
    label = labels[frame.stage]
    if frame.current and frame.total and frame.part and frame.current <= frame.total:
        label = f"{label} part {frame.part} ({frame.current}/{frame.total})"
    return Progress(frame.fraction, label, frame.stage, frame.part, frame.current, frame.total)


def _download_failure_receipt(
    row: JobRow, outcome: _Outcome, state: JobState, kind: str, retry_at: datetime | None
) -> Receipt:
    reason = reason_for(kind)
    status = (
        outcome.http_status
        if isinstance(outcome, JobFailed)
        and reason
        in {
            DownloadReason.PROVIDER_REFUSED,
            DownloadReason.RESPONSE_UNKNOWN,
            DownloadReason.NETWORK,
            DownloadReason.RETRY_EXHAUSTED,
        }
        else None
    )
    part = outcome.provider_part if isinstance(outcome, JobFailed) else None
    return Receipt(
        DownloadEvent(state),
        attempt=row.provider_attempts,
        reason=reason,
        http_status=status,
        part=part,
        retry_at=retry_at,
    )


def _safe_download_outcome(running: _Running, outcome: _Outcome) -> _Outcome:
    if not isinstance(outcome, JobFinished | JobFailed):
        return outcome
    accepted = running.provider
    outcomes = tuple(
        KeyOutcome(
            plugin=item.plugin,
            key=item.key,
            trailing_failures=min(1, item.trailing_failures),
            succeeded=item.succeeded,
            last_failure=reason_message(DownloadReason.PLUGIN),
        )
        for item in outcome.outcomes
        if accepted is not None
        and item.key == accepted.site
        and item.plugin in running.plugins
        and item.trailing_failures >= 0
    )
    if isinstance(outcome, JobFinished):
        return outcome.model_copy(update={"outcomes": outcomes})
    part = outcome.provider_part
    return outcome.model_copy(
        update={
            "message": reason_message(reason_for(outcome.kind), outcome.http_status),
            "outcomes": outcomes,
            "provider_part": part if accepted is not None and part in accepted.parts else None,
        }
    )


def _profile_refusal(
    running: _Running, row: JobRow, current_route: str | None, backend: str
) -> tuple[str, str] | None:
    matches_config = (
        current_route is not None
        and current_route == running.route
        and ((current_route == DIRECT_ROUTE) == (running.proxy is None))
    )
    if not matches_config or (row.provider_attempts and row.provider_route != running.route):
        return "route_changed", "The configured provider route changed. No retry scheduled."
    if row.provider_attempts and row.provider_backend != backend:
        return "backend_changed", "The configured download backend changed. No retry scheduled."
    return None


def _record_provider_hold(
    db: Session, selection: DownloadSelection, outcome: _Outcome, reason: HoldReason, row: JobRow
) -> None:
    part = 0
    if reason is not HoldReason.UNCERTAIN and isinstance(outcome, JobFailed):
        if outcome.provider_part is not None and outcome.provider_part in selection.parts:
            part = outcome.provider_part
        if selection.short and outcome.provider_video is not None:
            record_hold(
                db, DownloadSelection(selection.site, outcome.provider_video).key(), reason, row
            )
    record_hold(db, selection.key(part), reason, row)


def _redacted(running: _Running, outcome: _Outcome) -> _Outcome:
    """Return the outcome with the login taken out of every message, whatever printed it."""
    if isinstance(outcome, _Fault):
        return _Fault(running.redact(outcome.message))
    if not isinstance(outcome, JobFinished | JobFailed):
        return outcome
    outcomes = [
        each.model_copy(update={"last_failure": running.redact(each.last_failure)})
        for each in outcome.outcomes
    ]
    if isinstance(outcome, JobFailed):
        return outcome.model_copy(
            update={"outcomes": outcomes, "message": running.redact(outcome.message)}
        )
    return outcome.model_copy(update={"outcomes": outcomes})


def _lane_key(kind: AnyJobKind, lane: str) -> tuple[str, str]:
    """Return what the lane is busy and spaced by: its shared name, else its kind and name."""
    shared = kind.lanes[lane].shared if lane in kind.lanes else None
    return ("", shared) if shared is not None else (kind.name, lane)


def _lane_name(kind: AnyJobKind, request: object) -> str | None:
    """Return the lane the request puts a Job of `kind` in, or `None` when it has no lane."""
    if kind.lane_field is None or not isinstance(request, dict):
        return None
    lane = request.get(kind.lane_field)
    return lane if isinstance(lane, str) else None


def _due(now: datetime) -> ColumnElement[bool]:
    return or_(JobRow.not_before.is_(None), JobRow.not_before <= now)


def _get(db: Session, job_id: JobId) -> JobRow:
    row = db.get(JobRow, job_id)
    if row is None:  # pragma: no cover -- a Job row is never deleted
        message = f"There is no Job {job_id}."
        raise LookupError(message)
    return row
