"""The storage API: the space in use, what the policy wants, and an admin's preview of a limit.

Also the Downloads folder: where it is, and Finder showing it on the server's Mac.
"""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from medleyplay.application.downloads import DownloadService
from medleyplay.web.app import create_app
from medleyplay.web.deps import Services
from tests.conftest import TEST_HOST
from tests.support.api import add_bob, set_up_as_alice, sign_in
from tests.support.fakes import FakeFinder


@pytest.fixture
def on_this_mac(services: Services) -> Iterator[TestClient]:
    """A client whose requests come from the Mac the server runs on, through loopback."""
    app = create_app(services, allowed_hosts=[TEST_HOST])
    with TestClient(app, base_url=f"http://{TEST_HOST}", client=("127.0.0.1", 50000)) as client:
        yield client


def test_an_empty_household_uses_nothing_and_wants_nothing(client: TestClient) -> None:
    set_up_as_alice(client)

    storage = client.get("/api/storage").json()

    assert (storage["limit"], storage["downloads"], storage["cache"], storage["wanted"]) == (
        None,
        0,
        0,
        0,
    )
    assert (storage["wanted_by_account"], storage["error"], storage["preview"]) == ([], None, None)
    assert storage["free"] > 0
    assert storage["min_free"] >= 2 * 1024**3


def test_an_admin_previews_a_plan_at_another_limit(client: TestClient) -> None:
    set_up_as_alice(client)

    storage = client.get("/api/storage", params={"limit": 0}).json()

    assert storage["preview"] == {"removals": [], "starts": [], "shortfalls": []}


def test_a_member_sees_the_storage_but_cannot_preview(client: TestClient) -> None:
    set_up_as_alice(client)
    add_bob(client)
    sign_in(client, "bob")

    seen = client.get("/api/storage")
    previewed = client.get("/api/storage", params={"limit": 0})

    assert (seen.status_code, previewed.status_code) == (200, 403)


def test_the_storage_is_for_signed_in_accounts(client: TestClient) -> None:
    response = client.get("/api/storage")

    assert response.status_code == 401


def test_anyone_signed_in_reads_where_the_downloads_folder_is(client: TestClient) -> None:
    set_up_as_alice(client)
    add_bob(client)
    sign_in(client, "bob")

    folder = client.get("/api/storage/folder").json()

    assert folder["path"].endswith("downloads")
    assert folder["can_show"] is False


def test_an_admin_on_the_servers_mac_may_show_the_folder(on_this_mac: TestClient) -> None:
    set_up_as_alice(on_this_mac)

    folder = on_this_mac.get("/api/storage/folder").json()

    assert folder["can_show"] is True


def test_finder_shows_the_downloads_folder_for_an_admin_on_the_servers_mac(
    on_this_mac: TestClient, finder: FakeFinder, downloads: DownloadService
) -> None:
    set_up_as_alice(on_this_mac)

    shown = on_this_mac.post("/api/storage/folder/show")

    assert shown.status_code == 204
    assert finder.shown == [downloads.folder]


def test_finder_shows_nothing_for_a_request_from_another_device(
    client: TestClient, finder: FakeFinder
) -> None:
    set_up_as_alice(client)

    shown = client.post("/api/storage/folder/show")

    assert shown.status_code == 409
    assert finder.shown == []
