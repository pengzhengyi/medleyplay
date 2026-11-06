"""When an enricher is asked: when someone chooses, for the songs coming up, or for every Track.

The mode is the household's, one per enricher, set by an admin. Manually, the
default, asks only when someone chooses; *next* lets each page ask about the songs it
is about to play; *all* asks about every Track that may be asked about, at once and
whenever another becomes one. Every mode keeps the site's stop and each lane's pace.
"""

from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.accounts import AccountService
from medleyplay.application.enrichment import ENRICH_KIND, EnrichmentService, enrich_target
from medleyplay.domain.accounts import Account
from medleyplay.domain.enrichers import BILIBILI_DETAILS, MUSICBRAINZ, EnricherMode
from medleyplay.domain.errors import ForbiddenError
from tests.support.enrichment import Enriching, running_enrichment
from tests.support.factories import NewAccountFactory
from tests.support.fakes import FakeClock

NAME = BILIBILI_DETAILS.name


@pytest.fixture
def alice(accounts: AccountService) -> Account:
    return accounts.create_first_admin(NewAccountFactory.admin()).account


@pytest.fixture
def bob(accounts: AccountService, alice: Account) -> Account:
    return accounts.create_account(alice, NewAccountFactory.member())


@pytest.fixture
def enriching(
    units: sessionmaker[Session], clock: FakeClock, tmp_path: Path
) -> Iterator[Enriching]:
    with running_enrichment(units, clock, tmp_path / "data") as running:
        yield running


def _queued(enriching: Enriching) -> set[str]:
    """Return the targets of the enrich Jobs waiting or running."""
    return {
        view.job.target
        for view in enriching.jobs.list_jobs()
        if view.job.kind == ENRICH_KIND and view.job.state.is_active
    }


def test_an_enricher_is_asked_manually_until_an_admin_chooses_otherwise(
    enriching: Enriching,
) -> None:
    assert enriching.enrichment.state(NAME).mode is EnricherMode.MANUAL


def test_an_admin_sets_each_enricher_s_mode_which_a_restart_keeps(
    enriching: Enriching, alice: Account
) -> None:
    enriching.enrichment.set_mode(alice, NAME, EnricherMode.NEXT)
    restarted = EnrichmentService(
        enriching.units, enriching.clock, enriching.plugins, enriching.jobs, enriching.kind
    )

    assert restarted.state(NAME).mode is EnricherMode.NEXT
    assert restarted.state(MUSICBRAINZ.name).mode is EnricherMode.MANUAL


def test_a_member_cannot_set_the_mode(enriching: Enriching, bob: Account) -> None:
    with pytest.raises(ForbiddenError):
        enriching.enrichment.set_mode(bob, NAME, EnricherMode.ALL)

    assert enriching.enrichment.state(NAME).mode is EnricherMode.MANUAL


def test_finding_all_missing_queues_every_track_that_may_be_asked_about_at_once(
    enriching: Enriching, alice: Account
) -> None:
    first = enriching.add_site_track("BVNoCover")
    second = enriching.add_site_track("BVValues")
    enriching.add_file_track("Night Drive.m4a")

    enriching.enrichment.set_mode(alice, NAME, EnricherMode.ALL)

    assert _queued(enriching) == {enrich_target(first, NAME), enrich_target(second, NAME)}


def test_finding_all_missing_queues_a_track_added_later_when_it_sweeps(
    enriching: Enriching, alice: Account
) -> None:
    enriching.enrichment.set_mode(alice, NAME, EnricherMode.ALL)
    added = enriching.add_site_track("BVNoCover")

    queued = enriching.enrichment.sweep()

    assert queued == 1
    assert _queued(enriching) == {enrich_target(added, NAME)}
    assert {view.job.requested_by for view in enriching.jobs.list_jobs()} == {None}


@pytest.mark.parametrize("mode", [EnricherMode.MANUAL, EnricherMode.NEXT])
def test_only_finding_all_missing_asks_without_anyone_choosing(
    enriching: Enriching, alice: Account, mode: EnricherMode
) -> None:
    enriching.add_site_track("BVNoCover")

    enriching.enrichment.set_mode(alice, NAME, mode)
    queued = enriching.enrichment.sweep()

    assert queued == 0
    assert enriching.jobs.list_jobs() == []


def test_finding_all_missing_asks_nothing_once_the_site_stopped_the_enricher(
    enriching: Enriching, alice: Account
) -> None:
    refused = enriching.add_site_track("BVRefused")
    enriching.enrichment.find_details(alice, refused, NAME)
    enriching.finish_every_job()
    enriching.add_site_track("BVNoCover")

    enriching.enrichment.set_mode(alice, NAME, EnricherMode.ALL)
    queued = enriching.enrichment.sweep()

    assert queued == 0
    assert _queued(enriching) == set()
