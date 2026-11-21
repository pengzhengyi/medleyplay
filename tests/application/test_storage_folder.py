"""The folder Downloads are kept in: where it is, and showing it in Finder on the server's Mac."""

from pathlib import Path

import pytest

from medleyplay.application.storage_folder import StorageFolder
from medleyplay.domain.errors import ConflictError, ForbiddenError
from tests.support.factories import AccountFactory
from tests.support.fakes import FakeFinder

HOME = Path("/Users/alice")
DOWNLOADS = HOME / "Library/Application Support/medleyplay/downloads"


def test_names_the_folder_from_the_home_folder() -> None:
    folder = StorageFolder(DOWNLOADS, FakeFinder(), home=HOME)

    where = folder.where(AccountFactory.member(), local=True)

    assert where.path == "~/Library/Application Support/medleyplay/downloads"


def test_names_a_folder_outside_the_home_folder_in_full() -> None:
    folder = StorageFolder(Path("/Volumes/Music/downloads"), FakeFinder(), home=HOME)

    where = folder.where(AccountFactory.admin(), local=True)

    assert where.path == "/Volumes/Music/downloads"


@pytest.mark.parametrize(
    ("admin", "local", "can_show"),
    [(True, True, True), (True, False, False), (False, True, False)],
    ids=["an admin on the server's Mac", "an admin elsewhere", "a member on the server's Mac"],
)
def test_offers_finder_only_to_an_admin_on_the_servers_mac(
    *, admin: bool, local: bool, can_show: bool
) -> None:
    folder = StorageFolder(DOWNLOADS, FakeFinder(), home=HOME)
    caller = AccountFactory.admin() if admin else AccountFactory.member()

    where = folder.where(caller, local=local)

    assert where.can_show is can_show


def test_offers_no_finder_where_nothing_can_show_a_folder() -> None:
    folder = StorageFolder(DOWNLOADS, None, home=HOME)

    where = folder.where(AccountFactory.admin(), local=True)

    assert where.can_show is False


def test_shows_the_folder_in_finder_for_an_admin_on_the_servers_mac(tmp_path: Path) -> None:
    finder = FakeFinder()
    downloads = tmp_path / "downloads"
    folder = StorageFolder(downloads, finder, home=HOME)

    folder.show(AccountFactory.admin(), local=True)

    assert finder.shown == [downloads]
    assert downloads.is_dir()


def test_refuses_a_member(tmp_path: Path) -> None:
    finder = FakeFinder()
    folder = StorageFolder(tmp_path, finder, home=HOME)

    with pytest.raises(ForbiddenError):
        folder.show(AccountFactory.member(), local=True)

    assert finder.shown == []


def test_refuses_a_request_from_another_device(tmp_path: Path) -> None:
    finder = FakeFinder()
    folder = StorageFolder(tmp_path, finder, home=HOME)

    with pytest.raises(ConflictError, match="on the Mac medleyplay runs on"):
        folder.show(AccountFactory.admin(), local=False)

    assert finder.shown == []


def test_says_so_when_finder_cannot_show_it(tmp_path: Path) -> None:
    folder = StorageFolder(tmp_path, FakeFinder(fails=True), home=HOME)

    with pytest.raises(ConflictError, match="Finder could not show the Downloads folder"):
        folder.show(AccountFactory.admin(), local=True)
