"""A kind's lanes: Jobs of one lane run one at a time, spaced, and a kind may turn a Job away."""

import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import replace
from datetime import timedelta
from pathlib import Path
from typing import Literal

import pytest
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.jobs import JobKind, Lane
from medleyplay.domain.jobs import Job, JobId, JobState
from medleyplay.persistence.schema import JobRow
from tests.support.fakes import FakeClock
from tests.support.jobs import Jobs, running_jobs
from tests.support.programs import Echoed, EchoJob, echo_kind

SPACING = timedelta(seconds=5)
SETTLE = 0.6
"""Long enough for the runner, which polls every tenth of a second, to have looked."""


def kind_with_lanes(
    lanes: Mapping[str, Lane],
    completed: list[str] | None = None,
    *,
    refuse_start: Callable[[Session, object], str | None] | None = None,
    on_failure: Callable[[Session, Job, str, str], Sequence[JobId]] | None = None,
) -> JobKind[EchoJob, Echoed]:
    """The `echo` kind, whose Jobs run in the lane their request names."""
    return replace(
        echo_kind([] if completed is None else completed),
        lane_field="lane",
        lanes=lanes,
        refuse_start=refuse_start,
        on_failure=on_failure,
    )


def slow(lane: str) -> EchoJob:
    """A Job in `lane` that reports its progress for two seconds."""
    return EchoJob(text=lane, steps=2, step_seconds=1, lane=lane)


def _states(jobs: Jobs, *ids: JobId) -> list[JobState]:
    return [jobs.service.get_job(job_id).job.state for job_id in ids]


def test_jobs_of_one_lane_run_one_at_a_time_oldest_first(
    units: sessionmaker[Session], clock: FakeClock, tmp_path: Path
) -> None:
    kind = kind_with_lanes({"main": Lane()})
    with running_jobs(units, clock, tmp_path / "jobs", kind=kind) as jobs:
        first = jobs.submit(slow("main"), target="echo:1")
        second = jobs.submit(slow("main"), target="echo:2")
        jobs.wait_for(first.id, JobState.RUNNING, until=lambda view: view.progress is not None)

        while_first_runs = _states(jobs, first.id, second.id)
        jobs.wait_for(first.id, JobState.SUCCEEDED)
        jobs.wait_for(second.id, JobState.SUCCEEDED)

    assert while_first_runs == [JobState.RUNNING, JobState.QUEUED]


def test_jobs_of_different_lanes_run_together(
    units: sessionmaker[Session], clock: FakeClock, tmp_path: Path
) -> None:
    kind = kind_with_lanes({"north": Lane(), "south": Lane()})
    with running_jobs(units, clock, tmp_path / "jobs", kind=kind) as jobs:
        north = jobs.submit(slow("north"), target="echo:1")
        south = jobs.submit(slow("south"), target="echo:2")

        jobs.wait_for(north.id, JobState.RUNNING)
        jobs.wait_for(south.id, JobState.RUNNING)


def test_a_lane_waits_its_spacing_after_a_job_ends_before_starting_the_next(
    units: sessionmaker[Session], clock: FakeClock, tmp_path: Path
) -> None:
    kind = kind_with_lanes({"main": Lane(spacing=SPACING)})
    with running_jobs(units, clock, tmp_path / "jobs", kind=kind) as jobs:
        first = jobs.submit(EchoJob(text="a"), target="echo:1")
        jobs.wait_for(first.id, JobState.SUCCEEDED)
        second = jobs.submit(EchoJob(text="b"), target="echo:2")

        time.sleep(SETTLE)
        at_once = _states(jobs, second.id)
        jobs.retry_time_comes(SPACING - timedelta(seconds=1))
        time.sleep(SETTLE)
        just_before = _states(jobs, second.id)
        jobs.retry_time_comes(timedelta(seconds=1))
        jobs.wait_for(second.id, JobState.SUCCEEDED)

    assert (at_once, just_before) == ([JobState.QUEUED], [JobState.QUEUED])


def test_the_spacing_of_one_lane_does_not_hold_another(
    units: sessionmaker[Session], clock: FakeClock, tmp_path: Path
) -> None:
    kind = kind_with_lanes({"north": Lane(spacing=SPACING), "south": Lane()})
    with running_jobs(units, clock, tmp_path / "jobs", kind=kind) as jobs:
        first = jobs.submit(EchoJob(text="a", lane="north"), target="echo:1")
        jobs.wait_for(first.id, JobState.SUCCEEDED)
        waiting = jobs.submit(EchoJob(text="b", lane="north"), target="echo:2")
        other = jobs.submit(EchoJob(text="c", lane="south"), target="echo:3")

        jobs.wait_for(other.id, JobState.SUCCEEDED)

        assert _states(jobs, waiting.id) == [JobState.QUEUED]


def test_a_job_gets_the_proxy_of_its_lanes_site(
    units: sessionmaker[Session], clock: FakeClock, tmp_path: Path
) -> None:
    completed: list[str] = []
    kind = kind_with_lanes({"north": Lane(proxy_site="north"), "south": Lane()}, completed)
    proxies = _Proxies({"north": "socks5h://127.0.0.1:1", "south": "socks5h://127.0.0.1:2"})
    with running_jobs(units, clock, tmp_path / "jobs", kind=kind, proxies=proxies) as jobs:
        north = jobs.submit(EchoJob(text="x", echo_proxy=True, lane="north"), target="echo:1")
        jobs.wait_for(north.id, JobState.SUCCEEDED)
        south = jobs.submit(EchoJob(text="x", echo_proxy=True, lane="south"), target="echo:2")
        jobs.wait_for(south.id, JobState.SUCCEEDED)

    assert completed == ["proxy=socks5h://127.0.0.1:1", "proxy=None"]


def test_a_job_in_a_lane_the_kind_no_longer_has_fails_without_running(
    units: sessionmaker[Session], clock: FakeClock, tmp_path: Path
) -> None:
    completed: list[str] = []
    kind = kind_with_lanes({"main": Lane()}, completed)
    with running_jobs(units, clock, tmp_path / "jobs", kind=kind) as jobs:
        job = jobs.submit(EchoJob(text="x", lane="elsewhere"))

        failed = jobs.wait_for(job.id, JobState.FAILED)

    assert (failed.job.failure_kind, completed) == ("refused", [])
    assert "elsewhere" in failed.job.failure_message


def test_a_kind_can_turn_a_job_away_with_a_reason_and_it_never_runs(
    units: sessionmaker[Session], clock: FakeClock, tmp_path: Path
) -> None:
    completed: list[str] = []
    kind = kind_with_lanes({"main": Lane()}, completed, refuse_start=lambda *_: "Stopped for now.")
    with running_jobs(units, clock, tmp_path / "jobs", kind=kind) as jobs:
        job = jobs.submit(EchoJob(text="x"))

        failed = jobs.wait_for(job.id, JobState.FAILED)

    assert (failed.job.failure_kind, failed.job.failure_message, completed) == (
        "refused",
        "Stopped for now.",
        [],
    )


@pytest.mark.parametrize("why", ["gone", "refused"])
def test_a_program_can_fail_its_job_with_what_the_site_answered(
    units: sessionmaker[Session], clock: FakeClock, tmp_path: Path, why: Literal["gone", "refused"]
) -> None:
    with running_jobs(units, clock, tmp_path / "jobs") as jobs:
        job = jobs.submit(EchoJob(text="The site said no.", fail=why))

        failed = jobs.wait_for(job.id, JobState.FAILED)

    assert (failed.job.failure_kind, failed.job.failure_message, failed.job.attempts) == (
        why,
        "The site said no.",
        0,
    )


def test_a_kind_hears_of_the_failure_in_the_transaction_that_records_it(
    units: sessionmaker[Session], clock: FakeClock, tmp_path: Path
) -> None:
    heard: list[tuple[int, str, str, JobState]] = []

    def hear(db: Session, job: Job, kind: str, message: str) -> list[JobId]:
        # Inside the transaction that failed the Job, so the Job already reads as failed.
        state = JobState(db.get_one(JobRow, job.id).state)
        heard.append((job.id, kind, message, state))
        return []

    kind = kind_with_lanes({"main": Lane()}, on_failure=hear)
    with running_jobs(units, clock, tmp_path / "jobs", kind=kind) as jobs:
        job = jobs.submit(EchoJob(text="No.", fail="refused"))
        jobs.wait_for(job.id, JobState.FAILED)

    assert heard == [(job.id, "refused", "No.", JobState.FAILED)]


def test_a_kind_that_cannot_react_to_a_failure_still_has_the_job_fail(
    units: sessionmaker[Session], clock: FakeClock, tmp_path: Path
) -> None:
    def cannot(*_: object) -> list[JobId]:
        message = "no reaction"
        raise RuntimeError(message)

    with running_jobs(
        units, clock, tmp_path / "jobs", kind=kind_with_lanes({"main": Lane()}, on_failure=cannot)
    ) as jobs:
        job = jobs.submit(EchoJob(text="No.", fail="gone"))

        failed = jobs.wait_for(job.id, JobState.FAILED)

    assert failed.job.failure_kind == "gone"
    assert "could not be recorded" in failed.job.failure_message


class _Proxies:
    """The household's proxies, as the runner finds them."""

    def __init__(self, urls: dict[str, str]) -> None:
        self.urls = urls

    def current(self, site: str) -> str | None:
        return self.urls.get(site)
