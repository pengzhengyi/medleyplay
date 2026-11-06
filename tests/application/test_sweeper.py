"""The sweeper asks the enrichers set to find all soon after a notice, on a thread of its own."""

import time
from collections.abc import Iterator
from datetime import timedelta
from pathlib import Path

import pytest
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.accounts import AccountService
from medleyplay.application.sweeper import EnrichmentSweeper
from medleyplay.domain.accounts import Account
from medleyplay.domain.enrichers import BILIBILI_DETAILS, EnricherMode
from tests.support.enrichment import Enriching, running_enrichment
from tests.support.factories import NewAccountFactory
from tests.support.fakes import FakeClock

NAME = BILIBILI_DETAILS.name
WAIT = 5.0


@pytest.fixture
def alice(accounts: AccountService) -> Account:
    return accounts.create_first_admin(NewAccountFactory.admin()).account


@pytest.fixture
def enriching(
    units: sessionmaker[Session], clock: FakeClock, tmp_path: Path
) -> Iterator[Enriching]:
    with running_enrichment(units, clock, tmp_path / "data") as running:
        yield running


def _wait_for_jobs(enriching: Enriching, count: int) -> int:
    """Wait until `count` Jobs are listed, and return how many are."""
    ends = time.monotonic() + WAIT
    while time.monotonic() < ends and len(enriching.jobs.list_jobs()) < count:
        time.sleep(0.02)
    return len(enriching.jobs.list_jobs())


def test_a_notice_sweeps_soon_after_queueing_a_track_added_since(
    enriching: Enriching, alice: Account
) -> None:
    enriching.enrichment.set_mode(alice, NAME, EnricherMode.ALL)
    sweeper = EnrichmentSweeper(
        enriching.enrichment, delay=timedelta(milliseconds=10), tick=timedelta(hours=1)
    )
    sweeper.start()
    try:
        enriching.add_site_track("BVNoCover")

        sweeper.request("catalog")

        assert _wait_for_jobs(enriching, 1) == 1
    finally:
        sweeper.stop()


def test_a_failed_sweep_is_logged_and_the_next_still_runs(
    enriching: Enriching, alice: Account, caplog: pytest.LogCaptureFixture
) -> None:
    enriching.enrichment.set_mode(alice, NAME, EnricherMode.ALL)
    calls: list[int] = []

    class Flaky:
        def sweep(self) -> int:
            calls.append(1)
            if len(calls) == 1:
                message = "The database is locked."
                raise RuntimeError(message)
            return enriching.enrichment.sweep()

    sweeper = EnrichmentSweeper(Flaky(), delay=timedelta(milliseconds=10), tick=timedelta(hours=1))
    sweeper.start()
    try:
        enriching.add_site_track("BVNoCover")

        sweeper.request()

        assert _wait_for_jobs(enriching, 1) == 1
        assert "Sweeping the enrichers failed" in caplog.text
    finally:
        sweeper.stop()
