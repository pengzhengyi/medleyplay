"""A site's proxy reaches only that site's calls, through real Job processes and the test plugin."""

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import select, text
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.accounts import AccountService
from medleyplay.application.job_runner import NETWORK_RETRY
from medleyplay.application.links import Added, PartChoice
from medleyplay.application.plugins import FAULT_AFTER
from medleyplay.application.proxies import ProxyService
from medleyplay.domain.accounts import Account
from medleyplay.domain.catalog import SourceId
from medleyplay.domain.errors import InvalidInputError, KeychainUnavailableError, PluginCallError
from medleyplay.domain.jobs import Job, JobState, JobView
from medleyplay.domain.plugins import PluginState
from medleyplay.persistence.schema import SourceRow
from medleyplay.plugin_api import (
    CANONICALIZE,
    CREDENTIAL_SPEC,
    DOWNLOAD_PART,
    LIBRARY_BACKEND,
    READ_VIDEO,
    SOURCE_DOWNLOADER,
    SOURCE_RESOLVER,
    TAG_READER,
    Operation,
    ReadVideo,
)
from tests.support.factories import NewAccountFactory, SourceKeyFactory, TrackDetailsFactory
from tests.support.fakes import FakeClock, MemorySecrets
from tests.support.sites import Site, running_site

PROXY = "socks5h://alice:hunter2@127.0.0.1:7890"
SHORT_PASSWORD_PROXY = "http://alice:pw@127.0.0.1:3128"


@pytest.fixture
def alice(accounts: AccountService) -> Account:
    return accounts.create_first_admin(NewAccountFactory.admin()).account


@pytest.fixture
def site(
    units: sessionmaker[Session], clock: FakeClock, tmp_path: Path, secrets: MemorySecrets
) -> Iterator[Site]:
    with running_site(units, clock, tmp_path / "data", secrets) as running:
        yield running


def _start_download(site: Site, alice: Account, units: sessionmaker[Session], video: str) -> Job:
    """Start the download of the first part of `video`, as the household's play would."""
    key = SourceKeyFactory.bilibili(video)
    site.catalog.add_track(key, TrackDetailsFactory.song())
    with units() as db:
        source_id = db.scalars(select(SourceRow.id).where(SourceRow.locator == key.locator)).one()
    job = site.downloads.start(alice, SourceId(source_id))
    assert job is not None
    return job


def _download_of(site: Site, alice: Account, units: sessionmaker[Session], video: str) -> JobView:
    """Download `video` and return its Job once it has succeeded or failed once."""
    job = _start_download(site, alice, units, video)
    return site.wait_for(
        job.id,
        JobState.SUCCEEDED,
        JobState.QUEUED,
        JobState.FAILED,
        until=lambda each: (
            each.job.state is JobState.SUCCEEDED or each.job.failure_kind is not None
        ),
    )


def _said_by_the_download(site: Site, view: JobView) -> str:
    source_id = int(view.job.target.removeprefix("source:"))
    return (site.data_dir / "downloads" / f"{source_id}.m4a").read_text(encoding="utf-8")


def test_a_lookup_without_a_proxy_asks_the_plugin_with_none(site: Site, alice: Account) -> None:
    looked_up = site.links.lookup(alice, "https://b23.tv/proxy")

    assert (looked_up.video, looked_up.parts[0].title) == ("BVdirect", "proxy=none")


def test_a_lookup_hands_the_proxy_to_canonicalize_and_to_read(site: Site, alice: Account) -> None:
    site.proxies.save(alice, "bilibili", PROXY)

    looked_up = site.links.lookup(alice, "https://b23.tv/proxy")

    assert (looked_up.video, looked_up.parts[0].title) == ("BVproxied", f"proxy={PROXY}")


def test_a_download_gets_the_proxy_in_its_start(
    site: Site, alice: Account, units: sessionmaker[Session]
) -> None:
    site.proxies.save(alice, "bilibili", PROXY)

    view = _download_of(site, alice, units, "BVProxyEcho")

    assert view.job.state is JobState.SUCCEEDED
    assert _said_by_the_download(site, view) == f"proxy={PROXY}"


def test_a_download_without_a_proxy_starts_with_none(
    site: Site, alice: Account, units: sessionmaker[Session]
) -> None:
    view = _download_of(site, alice, units, "BVProxyEcho")

    assert _said_by_the_download(site, view) == "proxy=none"


def test_the_proxy_is_never_written_into_the_job(
    site: Site, alice: Account, units: sessionmaker[Session]
) -> None:
    site.proxies.save(alice, "bilibili", PROXY)

    view = _download_of(site, alice, units, "BVProxyEcho")

    with units() as db:
        stored = db.execute(text("SELECT request FROM job")).scalars().all()
    assert stored != []
    assert "hunter2" not in repr(stored)
    assert "hunter2" not in repr(view)


def test_saving_or_removing_a_proxy_forgets_the_looked_up_videos(
    site: Site, alice: Account
) -> None:
    link = "https://b23.tv/proxy"
    site.links.lookup(alice, link)

    site.proxies.save(alice, "bilibili", PROXY)
    saved = site.links.lookup(alice, link)
    site.proxies.remove(alice, "bilibili")
    removed = site.links.lookup(alice, link)

    assert (saved.parts[0].title, removed.parts[0].title) == (f"proxy={PROXY}", "proxy=none")


def test_a_lookup_fails_while_the_keychain_does_not_answer_for_the_proxy(
    site: Site, alice: Account, units: sessionmaker[Session], clock: FakeClock
) -> None:
    ProxyService(units, clock, site.secrets).save(alice, "bilibili", PROXY)
    site.secrets.unavailable = True

    with pytest.raises(KeychainUnavailableError):
        site.links.lookup(alice, "https://b23.tv/proxy")

    site.secrets.unavailable = False
    assert site.links.lookup(alice, "https://b23.tv/proxy").parts[0].title == f"proxy={PROXY}"


def test_a_download_waits_while_the_keychain_does_not_answer_for_the_proxy(
    site: Site, alice: Account, units: sessionmaker[Session], clock: FakeClock
) -> None:
    ProxyService(units, clock, site.secrets).save(alice, "bilibili", PROXY)
    site.secrets.unavailable = True
    job = _start_download(site, alice, units, "BVProxyEcho")

    waiting = site.wait_for(job.id, JobState.WAITING)
    site.secrets.unavailable = False
    clock.advance(NETWORK_RETRY)
    finished = site.wait_for(job.id, JobState.SUCCEEDED)

    assert (waiting.job.failure_kind, waiting.job.attempts) == ("keychain", 0)
    assert _said_by_the_download(site, finished) == f"proxy={PROXY}"


def test_a_host_call_fault_never_keeps_the_login_of_the_proxy(site: Site, alice: Account) -> None:
    site.proxies.save(alice, "bilibili", SHORT_PASSWORD_PROXY)

    lookup = site.links.lookup(alice, "https://www.bilibili.com/video/BVProxyLeak")

    assert lookup.unreadable is not None
    assert "Failed through http://<redacted>@127.0.0.1:3128" in lookup.unreadable.message
    assert "pw" not in lookup.unreadable.message.replace("Failed through", "")


def test_a_plugin_fault_reason_never_keeps_the_login_of_the_proxy(
    site: Site, alice: Account
) -> None:
    request = ReadVideo(video="BVProxyLeak", proxy=PROXY)

    for _ in range(FAULT_AFTER):
        with pytest.raises(PluginCallError):
            site.plugins.call(READ_VIDEO, "bilibili", request)

    [tube] = [each for each in site.plugins.statuses(alice) if each.name == "tube"]
    assert tube.state is PluginState.FAULTED
    assert "hunter2" not in tube.reason
    assert "socks5h://<redacted>@127.0.0.1:7890" in tube.reason


def test_a_failure_message_of_a_download_never_keeps_the_login_of_the_proxy(
    site: Site, alice: Account, units: sessionmaker[Session]
) -> None:
    site.proxies.save(alice, "bilibili", SHORT_PASSWORD_PROXY)

    view = _download_of(site, alice, units, "BVProxyLeak")

    assert view.job.failure_kind == "plugin"
    assert "Failed through http://<redacted>@127.0.0.1:3128" in view.job.failure_message
    assert "alice" not in view.job.failure_message


def test_a_progress_message_never_keeps_the_login_of_the_proxy(
    site: Site, alice: Account, units: sessionmaker[Session]
) -> None:
    site.proxies.save(alice, "bilibili", PROXY)
    job = _start_download(site, alice, units, "BVProxyProgress")

    view = site.wait_for(job.id, JobState.RUNNING, until=lambda each: each.progress is not None)

    assert view.progress is not None
    assert view.progress.message == "Through socks5h://<redacted>@127.0.0.1:7890"
    site.wait_for(job.id, JobState.SUCCEEDED)


def test_a_running_download_keeps_the_proxy_it_started_with(
    site: Site, alice: Account, units: sessionmaker[Session]
) -> None:
    site.proxies.save(alice, "bilibili", PROXY)
    job = _start_download(site, alice, units, "BVProxyProgress")
    site.wait_for(job.id, JobState.RUNNING, until=lambda each: each.progress is not None)

    site.proxies.remove(alice, "bilibili")

    site.wait_for(job.id, JobState.SUCCEEDED)
    assert site.proxies.current("bilibili") is None


def test_adding_a_video_after_a_proxy_is_set_downloads_through_it(
    site: Site, alice: Account
) -> None:
    site.proxies.save(alice, "bilibili", PROXY)

    added: list[Added] = site.links.add(
        alice, "https://www.bilibili.com/video/BVProxyEcho", "best", [PartChoice(1, "Song", "Band")]
    )

    assert added[0].job is not None
    finished = site.wait_for(added[0].job.id, JobState.SUCCEEDED)
    assert _said_by_the_download(site, finished) == f"proxy={PROXY}"


def test_a_refused_link_is_still_refused_with_a_proxy_set(site: Site, alice: Account) -> None:
    site.proxies.save(alice, "bilibili", PROXY)

    with pytest.raises(InvalidInputError):
        site.links.lookup(alice, "https://evil.example/video/BV1Xx41117Tz")


OPERATIONS_THAT_REACH_A_SITE = {CANONICALIZE, READ_VIDEO, DOWNLOAD_PART}
# Any: each point has its own provider, and each operation its own request and reply.
type AnyOperation = Operation[Any, Any, Any]
EVERY_OPERATION: list[AnyOperation] = [
    operation
    for point in (SOURCE_RESOLVER, SOURCE_DOWNLOADER, CREDENTIAL_SPEC, LIBRARY_BACKEND, TAG_READER)
    for operation in point.operations.values()
]


@pytest.mark.parametrize(
    "operation", EVERY_OPERATION, ids=lambda each: f"{each.point.name}.{each.name}"
)
def test_only_the_calls_that_reach_a_site_can_carry_a_proxy(operation: AnyOperation) -> None:
    carries = "proxy" in operation.request.model_fields

    assert carries == (operation in OPERATIONS_THAT_REACH_A_SITE)
