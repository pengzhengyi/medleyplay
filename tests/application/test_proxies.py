"""The proxy service: an admin's proxy for a site, kept in the Keychain and read once."""

from datetime import timedelta

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.catalog import CatalogService
from medleyplay.application.proxies import ProxyService
from medleyplay.domain.catalog import SourceState
from medleyplay.domain.errors import (
    ForbiddenError,
    InvalidInputError,
    KeychainUnavailableError,
    NotFoundError,
)
from medleyplay.domain.proxies import ProxyScheme, ProxySummary
from medleyplay.persistence.schema import PluginStateRow, ProxyRow, SourceRow
from tests.support.factories import AccountFactory, SourceKeyFactory, TrackDetailsFactory
from tests.support.fakes import FakeClock, MemorySecrets

ADMIN = AccountFactory.admin()
MEMBER = AccountFactory.member()
URL = "socks5h://alice:s3cret@127.0.0.1:7890"


@pytest.fixture
def forgotten() -> list[str]:
    """What the service told its listeners: `lookups` each time the proxy changed."""
    return []


@pytest.fixture
def proxies(
    units: sessionmaker[Session], clock: FakeClock, secrets: MemorySecrets, forgotten: list[str]
) -> ProxyService:
    service = ProxyService(units, clock, secrets)
    service.listen(lambda: forgotten.append("lookups"))
    return service


def test_saving_keeps_the_whole_url_in_the_keychain_and_a_summary_in_the_catalog(
    proxies: ProxyService, secrets: MemorySecrets, units: sessionmaker[Session], clock: FakeClock
) -> None:
    saved = proxies.save(ADMIN, "bilibili", URL)

    assert saved.summary == ProxySummary(ProxyScheme.SOCKS5H, "127.0.0.1", 7890, has_login=True)
    assert saved.saved_at == clock.now
    assert secrets.items == {"proxy:bilibili": URL}
    with units() as db:
        row = db.get_one(ProxyRow, "bilibili")
        assert (row.scheme, row.host, row.port, row.has_login, row.saved_at) == (
            "socks5h",
            "127.0.0.1",
            7890,
            True,
            clock.now,
        )
        assert "s3cret" not in repr(db.execute(text("SELECT * FROM proxy")).all())


def test_saving_keeps_the_url_rebuilt_from_its_parts(
    proxies: ProxyService, secrets: MemorySecrets
) -> None:
    proxies.save(ADMIN, "bilibili", "SOCKS5H://alice:p@ss@Proxy.LAN:1080/")

    assert secrets.items == {"proxy:bilibili": "socks5h://alice:p%40ss@proxy.lan:1080"}


def test_the_keychain_is_written_before_the_row(
    proxies: ProxyService, secrets: MemorySecrets, units: sessionmaker[Session]
) -> None:
    rows_when_keeping: list[int] = []

    def count_rows() -> None:
        with units() as db:
            rows_when_keeping.append(len(db.execute(text("SELECT * FROM proxy")).all()))

    secrets.while_setting = count_rows

    proxies.save(ADMIN, "bilibili", URL)

    assert rows_when_keeping == [0]


def test_saving_again_replaces_the_proxy(proxies: ProxyService, secrets: MemorySecrets) -> None:
    proxies.save(ADMIN, "bilibili", URL)

    saved = proxies.save(ADMIN, "bilibili", "http://127.0.0.1:3128")

    assert saved.summary == ProxySummary(ProxyScheme.HTTP, "127.0.0.1", 3128, has_login=False)
    assert secrets.items == {"proxy:bilibili": "http://127.0.0.1:3128"}
    assert proxies.current("bilibili") == "http://127.0.0.1:3128"
    assert proxies.get(ADMIN, "bilibili") == saved


def test_nothing_is_set_until_a_proxy_is_saved(proxies: ProxyService) -> None:
    assert proxies.get(ADMIN, "bilibili") is None
    assert proxies.current("bilibili") is None


def test_a_proxy_that_is_not_a_proxy_is_refused_and_nothing_is_kept(
    proxies: ProxyService, secrets: MemorySecrets, forgotten: list[str]
) -> None:
    with pytest.raises(InvalidInputError, match="socks5h"):
        proxies.save(ADMIN, "bilibili", "socks5://127.0.0.1:1080")

    assert secrets.items == {}
    assert proxies.get(ADMIN, "bilibili") is None
    assert forgotten == []


def test_a_member_may_neither_read_set_nor_remove_a_proxy(
    proxies: ProxyService, secrets: MemorySecrets
) -> None:
    for call in (
        lambda: proxies.get(MEMBER, "bilibili"),
        lambda: proxies.save(MEMBER, "bilibili", URL),
        lambda: proxies.remove(MEMBER, "bilibili"),
    ):
        with pytest.raises(ForbiddenError):
            call()

    assert secrets.items == {}


@pytest.mark.parametrize("site", ["youtube", "Bilibili", "../x"])
def test_a_site_no_plugin_takes_a_proxy_for_is_not_found(proxies: ProxyService, site: str) -> None:
    for call in (
        lambda: proxies.get(ADMIN, site),
        lambda: proxies.save(ADMIN, site, URL),
        lambda: proxies.remove(ADMIN, site),
    ):
        with pytest.raises(NotFoundError):
            call()

    assert proxies.current(site) is None


def test_removing_forgets_the_url_and_the_row_and_removing_again_is_fine(
    proxies: ProxyService, secrets: MemorySecrets
) -> None:
    proxies.save(ADMIN, "bilibili", URL)

    proxies.remove(ADMIN, "bilibili")
    proxies.remove(ADMIN, "bilibili")

    assert secrets.items == {}
    assert proxies.get(ADMIN, "bilibili") is None
    assert proxies.current("bilibili") is None


def test_a_proxy_is_read_from_the_keychain_once_and_then_kept_in_memory(
    units: sessionmaker[Session], clock: FakeClock, secrets: MemorySecrets
) -> None:
    ProxyService(units, clock, secrets).save(ADMIN, "bilibili", URL)
    restarted = ProxyService(units, clock, secrets)
    secrets.reads = 0

    first, second, third = (restarted.current("bilibili") for _ in range(3))

    assert (first, second, third) == (URL, URL, URL)
    assert secrets.reads == 1


def test_a_saved_proxy_is_in_memory_without_asking_the_keychain(
    proxies: ProxyService, secrets: MemorySecrets
) -> None:
    proxies.save(ADMIN, "bilibili", URL)
    secrets.reads = 0

    assert proxies.current("bilibili") == URL
    assert secrets.reads == 0


def test_no_proxy_is_known_without_asking_the_keychain(
    proxies: ProxyService, secrets: MemorySecrets
) -> None:
    assert [proxies.current("bilibili") for _ in range(2)] == [None, None]
    assert secrets.reads == 0


def test_a_keychain_that_does_not_answer_fails_the_read_and_the_next_read_tries_again(
    units: sessionmaker[Session], clock: FakeClock, secrets: MemorySecrets
) -> None:
    ProxyService(units, clock, secrets).save(ADMIN, "bilibili", URL)
    restarted = ProxyService(units, clock, secrets)
    secrets.unavailable = True

    with pytest.raises(KeychainUnavailableError):
        restarted.current("bilibili")

    secrets.unavailable = False
    assert restarted.current("bilibili") == URL


def test_a_proxy_the_keychain_no_longer_holds_fails_the_read_rather_than_going_direct(
    units: sessionmaker[Session], clock: FakeClock, secrets: MemorySecrets
) -> None:
    ProxyService(units, clock, secrets).save(ADMIN, "bilibili", URL)
    secrets.items.clear()

    with pytest.raises(KeychainUnavailableError, match="set it again"):
        ProxyService(units, clock, secrets).current("bilibili")


def test_a_keychain_that_does_not_answer_fails_the_save_and_keeps_no_row(
    proxies: ProxyService, secrets: MemorySecrets, forgotten: list[str]
) -> None:
    secrets.unavailable = True

    with pytest.raises(KeychainUnavailableError):
        proxies.save(ADMIN, "bilibili", URL)

    secrets.unavailable = False
    assert proxies.get(ADMIN, "bilibili") is None
    assert proxies.current("bilibili") is None
    assert forgotten == []


def test_a_keychain_that_does_not_answer_fails_the_removal_and_keeps_the_proxy(
    proxies: ProxyService, secrets: MemorySecrets
) -> None:
    proxies.save(ADMIN, "bilibili", URL)
    secrets.unavailable = True

    with pytest.raises(KeychainUnavailableError):
        proxies.remove(ADMIN, "bilibili")

    secrets.unavailable = False
    assert proxies.get(ADMIN, "bilibili") is not None
    assert proxies.current("bilibili") == URL


def test_saving_and_removing_each_tell_the_listeners_to_forget_looked_up_videos(
    proxies: ProxyService, forgotten: list[str]
) -> None:
    proxies.save(ADMIN, "bilibili", URL)
    proxies.remove(ADMIN, "bilibili")

    assert forgotten == ["lookups", "lookups"]


def test_saving_and_removing_reset_nothing_else(
    proxies: ProxyService, units: sessionmaker[Session], clock: FakeClock, catalog: CatalogService
) -> None:
    catalog.add_track(SourceKeyFactory.bilibili(), TrackDetailsFactory.song())
    with units.begin() as db:
        db.add(PluginStateRow(name="bilibili", faulted_at=clock.now, fault_reason="Five faults."))
        db.execute(text("UPDATE source SET state = :state"), {"state": SourceState.UNAVAILABLE})
        db.execute(
            text(
                "INSERT INTO job (kind, target, state, request, attempts, interruptions,"
                " failure_kind, failure_message, created_at)"
                " VALUES ('download_source', 'source:1', 'failed', '{}', 3, 0, 'plugin',"
                " 'It refused (412).', '2026-01-01 00:00:00.000000')"
            )
        )
    before = _rows(units)
    clock.advance(timedelta(hours=1))

    proxies.save(ADMIN, "bilibili", URL)
    proxies.remove(ADMIN, "bilibili")

    assert _rows(units) == before
    with units() as db:
        assert db.get_one(SourceRow, 1).state == SourceState.UNAVAILABLE


def _rows(units: sessionmaker[Session]) -> list[list[object]]:
    """Every row of the tables a proxy change must leave alone."""
    queries = (
        "SELECT * FROM plugin_state ORDER BY 1",
        "SELECT * FROM source ORDER BY 1",
        "SELECT * FROM job ORDER BY 1",
        "SELECT * FROM linked_account ORDER BY 1",
    )
    with units() as db:
        return [[tuple(row) for row in db.execute(text(query)).all()] for query in queries]
