"""On-demand storage measurements stay inside the managed layout."""

from pathlib import Path

from medleyplay.application.storage_inspection import StorageInspection
from medleyplay.config import CONFIG_FILE
from tests.support.factories import AccountFactory


def test_an_intermediate_directory_link_never_counts_data_outside_the_root(tmp_path: Path) -> None:
    root = tmp_path / "data"
    root.mkdir()
    outside = tmp_path / "elsewhere"
    (outside / "sources").mkdir(parents=True)
    (outside / "sources/song").write_bytes(b"not managed")
    (root / "cache").symlink_to(outside, target_is_directory=True)
    (root / CONFIG_FILE).symlink_to(outside / "sources/song")
    service = StorageInspection(
        root, CONFIG_FILE, multiple_accounts=False, safe_mode=True, wal_enabled=False
    )

    measured = service.inspect(AccountFactory.admin())

    assert measured.cache == measured.configuration == 0


def test_an_admin_gets_the_same_measurement_until_the_minute_ends(tmp_path: Path) -> None:
    now = 123.0
    service = StorageInspection(
        tmp_path,
        CONFIG_FILE,
        multiple_accounts=False,
        safe_mode=True,
        wal_enabled=False,
        clock=lambda: now,
    )
    admin = AccountFactory.admin()
    assert service.inspect(admin).configuration == 0
    (tmp_path / CONFIG_FILE).write_bytes(b"changed")

    now += 59
    assert service.inspect(admin).configuration == 0
    now += 1
    assert service.inspect(admin).configuration == 7
