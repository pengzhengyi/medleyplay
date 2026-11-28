"""Provider Holds follow the selection, not the Track or a visible Job."""

import fcntl
from pathlib import Path

import pytest
from sqlalchemy import update
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.accounts import AccountService
from medleyplay.application.download_holds import hold_of, record_hold, reserve_dispatch
from medleyplay.domain.download_holds import DownloadHoldKey, DownloadSelection, HoldReason
from medleyplay.domain.errors import ConflictError
from medleyplay.domain.jobs import JobId, JobState
from medleyplay.persistence.schema import JobRow
from tests.support.factories import NewAccountFactory
from tests.support.fakes import FakeClock, MemorySecrets
from tests.support.sites import running_site


def test_a_part_hold_survives_transactions_and_covers_joins_containing_that_part(
    units: sessionmaker[Session],
) -> None:
    with units.begin() as db:
        record_hold(db, DownloadHoldKey("bilibili", video="BVAlbum", part=2), HoldReason.REFUSED)

    with units() as db:
        assert hold_of(db, DownloadSelection("bilibili", video="BVAlbum", parts=(2,)))
        assert hold_of(db, DownloadSelection("bilibili", video="BVAlbum", parts=(1, 2, 3)))
        assert not hold_of(db, DownloadSelection("bilibili", video="BVAlbum", parts=(1, 3)))
        assert not hold_of(db, DownloadSelection("other", video="BVAlbum", parts=(2,)))


def test_a_video_hold_matches_all_parts_but_does_not_infer_an_unresolved_short_link(
    units: sessionmaker[Session],
) -> None:
    with units.begin() as db:
        record_hold(db, DownloadHoldKey("bilibili", video="BVAlbum"), HoldReason.UNKNOWN)
        record_hold(db, DownloadHoldKey("bilibili", short="held"), HoldReason.UNCERTAIN)

    with units() as db:
        assert hold_of(db, DownloadSelection("bilibili", video="BVAlbum"))
        assert hold_of(db, DownloadSelection("bilibili", video="BVAlbum", parts=(3,)))
        assert hold_of(db, DownloadSelection.from_link("http://b23.tv/held/?p=2"))
        assert not hold_of(db, DownloadSelection.from_link("https://b23.tv/other"))


@pytest.mark.parametrize(
    ("held", "lookup"), [("av170001", "BV17x411w7KC"), ("BV17x411w7KC", "AV170001")]
)
def test_a_whole_video_hold_covers_its_other_id(
    units: sessionmaker[Session], held: str, lookup: str
) -> None:
    with units.begin() as db:
        record_hold(db, DownloadHoldKey("bilibili", video=held), HoldReason.UNKNOWN)

    with units() as db:
        selection = DownloadSelection.from_link(f"https://www.bilibili.com/video/{lookup}")
        assert hold_of(db, selection) is HoldReason.UNKNOWN


def test_restart_holds_legacy_replays_even_when_the_job_is_not_running(
    units: sessionmaker[Session], clock: FakeClock, tmp_path: Path, secrets: MemorySecrets
) -> None:
    job_ids: list[JobId] = []
    with units.begin() as db:
        for state, video, kind in (
            (JobState.RUNNING, "BVLegacyRunning", None),
            (JobState.QUEUED, "BVLegacy403", "plugin"),
            (JobState.QUEUED, "BVLegacy412", "plugin"),
            (JobState.WAITING, "BVLegacy429", "network"),
            (JobState.FAILED, "BVLegacyPolicy", "plugin"),
        ):
            row = JobRow(
                kind="download_source",
                target=video,
                state=state,
                request={"site": "bilibili", "video": video, "part": 1},
                failure_kind=kind,
                created_at=clock(),
                started_at=clock(),
            )
            db.add(row)
            db.flush()
            job_ids.append(JobId(row.id))
        db.execute(update(JobRow).where(JobRow.id.in_(job_ids)).values(provider_attempts=None))

    with running_site(units, clock, tmp_path / "data", secrets) as site, units() as db:
        for job_id in job_ids:
            job = site.jobs.get_job(job_id).job
            row = db.get_one(JobRow, job_id)
            video = str(row.request["video"])
            assert job.state is JobState.FAILED
            assert job.finished_at == clock()
            assert job.failure_kind == HoldReason.UNCERTAIN
            assert row.provider_attempts == 0
            assert hold_of(db, DownloadSelection("bilibili", video, (2,))) is HoldReason.UNCERTAIN


def test_recovery_keeps_the_provider_lane_until_the_previous_writer_stops(
    units: sessionmaker[Session],
    accounts: AccountService,
    clock: FakeClock,
    tmp_path: Path,
    secrets: MemorySecrets,
) -> None:
    alice = accounts.create_first_admin(NewAccountFactory.admin()).account
    abandoned = DownloadSelection("bilibili", "BVAbandoned", (1,))
    folder = tmp_path / "data"
    with units.begin() as db:
        row = JobRow(
            kind="download_source",
            target="source:1",
            state=JobState.RUNNING,
            request={"site": "bilibili", "video": "BVAbandoned", "part": 1},
            created_at=clock(),
            provider_attempts=1,
        )
        db.add(row)
        db.flush()
        job_id = JobId(row.id)
        assert reserve_dispatch(db, abandoned, job_id)

    lock = folder / "jobs" / str(job_id) / "lock"
    lock.parent.mkdir(parents=True)
    with (
        lock.open("w") as writer,
    ):
        fcntl.flock(writer, fcntl.LOCK_EX)
        with running_site(units, clock, folder, secrets) as site:
            assert site.jobs.get_job(job_id).job.failure_kind == HoldReason.UNCERTAIN
            with pytest.raises(ConflictError, match="busy"):
                site.links.lookup(alice, "https://b23.tv/night")

    with running_site(units, clock, folder, secrets) as restarted:
        assert restarted.links.lookup(alice, "https://b23.tv/night").video == "BV1Xx41117Tz"
        with pytest.raises(ConflictError, match="held"):
            restarted.links.lookup(alice, "https://www.bilibili.com/video/BVAbandoned")
