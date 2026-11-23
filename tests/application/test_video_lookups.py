"""A saved video lookup belongs to its Account, not a browser or server process."""

from pathlib import Path

import pytest
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.accounts import AccountService
from medleyplay.application.links import PartChoice
from medleyplay.domain.errors import ConflictError, OfflineError
from medleyplay.domain.jobs import JobState
from tests.support.factories import NewAccountFactory
from tests.support.fakes import FakeClock, MemorySecrets
from tests.support.sites import running_site


def test_restarting_resumes_queued_work_and_keeps_only_unfinished_choices(
    units: sessionmaker[Session],
    accounts: AccountService,
    clock: FakeClock,
    tmp_path: Path,
    secrets: MemorySecrets,
) -> None:
    alice = accounts.create_first_admin(NewAccountFactory.admin()).account
    folder = tmp_path / "data"
    with running_site(units, clock, folder, secrets) as site:
        ready = site.video_lookups.start(alice, "https://b23.tv/night")
        site.wait_for(ready.id, JobState.SUCCEEDED)
        site.jobs.stop()
        queued = site.video_lookups.start(alice, "https://www.bilibili.com/video/BVgone?p=4")
        discarded = site.video_lookups.start(alice, "BV17x411w7KC")
        assert site.video_lookups.start(alice, "https://b23.tv/night#shared").id == ready.id
        site.video_lookups.dismiss(alice, discarded.id)
        with pytest.raises(ConflictError):
            site.jobs.retry(alice, discarded.id)
        assert queued.state is JobState.QUEUED

    with running_site(units, clock, folder, secrets) as restarted:
        restarted.wait_for(queued.id, JobState.SUCCEEDED)
        assert [row.id for row in restarted.video_lookups.list_for(alice)] == [queued.id, ready.id]
        result = restarted.video_lookups.get(alice, queued.id).result
        assert result is not None
        assert result.unreadable is not None
        assert result.parts[0].part == 4
        added = restarted.video_lookups.confirm(
            alice, queued.id, "best", [PartChoice(5, "Encore", "")]
        )
        assert added[0].job is not None
        restarted.video_lookups.dismiss(alice, ready.id)

    with running_site(units, clock, folder, secrets) as reopened:
        assert reopened.video_lookups.list_for(alice) == []


def test_a_failed_lookup_stays_visible_until_dismissed_even_offline(
    units: sessionmaker[Session],
    accounts: AccountService,
    clock: FakeClock,
    tmp_path: Path,
    secrets: MemorySecrets,
) -> None:
    alice = accounts.create_first_admin(NewAccountFactory.admin()).account
    with running_site(units, clock, tmp_path / "data", secrets) as site:
        asked = site.video_lookups.start(alice, "https://b23.tv/away")
        site.wait_for(asked.id, JobState.FAILED)
        site.online.online = False

        [failed] = site.video_lookups.list_for(alice)
        assert (failed.state, failed.message) == (
            JobState.FAILED,
            "The link doesn't name a Bilibili video.",
        )
        assert site.video_lookups.get(alice, asked.id).result is None
        with pytest.raises(OfflineError):
            site.video_lookups.start(alice, "BV1Xx41117Tz")
        site.video_lookups.dismiss(alice, asked.id)
        assert site.video_lookups.list_for(alice) == []


def test_a_proxy_echoed_by_the_resolver_never_enters_the_saved_result(
    units: sessionmaker[Session],
    accounts: AccountService,
    clock: FakeClock,
    tmp_path: Path,
    secrets: MemorySecrets,
) -> None:
    alice = accounts.create_first_admin(NewAccountFactory.admin()).account
    with running_site(units, clock, tmp_path / "data", secrets) as site:
        site.proxies.save(alice, "bilibili", "http://test:fake-password@proxy.test:1234")
        saved = site.video_lookups.start(alice, "https://b23.tv/proxy?token=not-for-storage")
        site.wait_for(saved.id, JobState.SUCCEEDED)

        result = site.video_lookups.get(alice, saved.id).result
        assert result is not None
        assert result.video == "BVproxied"
        assert result.parts[0].title == "proxy=<redacted>"
