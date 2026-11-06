"""Where a device on the network can reach the server, so a page can show the way there."""

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from medleyplay.web.app import create_app
from medleyplay.web.deps import Services
from tests.conftest import TEST_HOST
from tests.support.api import set_up_as_alice

HOSTS = (
    TEST_HOST,
    "localhost",
    "127.0.0.1",
    "::1",
    "mac-mini",
    "mac-mini.local",
    "192.168.1.20",
    "169.254.10.4",
    "fe80::1",
    "music.home",
)
"""The names a server on the Mac `mac-mini` answers to, with a router's name for it."""


@pytest.fixture
def lan_client(services: Services, tmp_path: Path) -> Iterator[TestClient]:
    """A client of a server answering to `HOSTS`."""
    app = create_app(services, allowed_hosts=HOSTS, client_dir=tmp_path / "client")
    with TestClient(app, base_url=f"http://{TEST_HOST}") as test_client:
        yield test_client


def test_the_addresses_a_device_on_the_network_can_open_come_with_its_address_first(
    lan_client: TestClient,
) -> None:
    set_up_as_alice(lan_client)

    response = lan_client.get("/api/addresses")

    assert response.json() == {"addresses": ["192.168.1.20", "mac-mini.local", "music.home"]}


def test_the_addresses_need_a_sign_in(lan_client: TestClient) -> None:
    assert lan_client.get("/api/addresses").status_code == 401
