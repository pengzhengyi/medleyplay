"""Authenticated, explicit picture search with a household key kept outside the database."""

import pytest
from fastapi.testclient import TestClient

from medleyplay.application.plugins import PluginService
from tests.support.api import add_bob, set_up_as_alice, sign_in

ROOT = "/api/image-search"
KEY = "only-a-test-key"
ALBUM = {"album": "Help!", "artist": "The Beatles"}


def test_only_an_admin_can_set_or_remove_the_household_key(client: TestClient) -> None:
    assert client.get(ROOT).status_code == 401
    set_up_as_alice(client)
    assert client.get(ROOT).json() == {"configured": False}
    assert client.put(f"{ROOT}/key", json={"key": KEY}).json() == {"configured": True}
    add_bob(client)
    sign_in(client, "bob")

    assert client.get(ROOT).json() == {"configured": True}
    assert client.put(f"{ROOT}/key", json={"key": "replacement"}).status_code == 403
    assert client.delete(f"{ROOT}/key").status_code == 403

    sign_in(client, "alice")
    assert client.delete(f"{ROOT}/key").json() == {"configured": False}
    assert client.get(ROOT).json() == {"configured": False}


def test_a_malformed_key_request_does_not_echo_the_body(client: TestClient) -> None:
    set_up_as_alice(client)

    response = client.put(f"{ROOT}/key", json={"wrong": KEY})

    assert response.status_code == 422
    assert KEY not in response.text


def test_reading_results_never_starts_a_search_and_needs_no_key(client: TestClient) -> None:
    set_up_as_alice(client)

    assert client.get(f"{ROOT}/results", params=ALBUM).json() == {
        "searching": False,
        "waiting": False,
        "failure": None,
        "images": [],
    }
    assert client.post(f"{ROOT}/results", json=ALBUM).status_code == 409
    assert client.get(f"{ROOT}/results", params={"album": "", "artist": ""}).status_code == 422


def test_only_an_explicit_member_search_queues_a_job(
    client: TestClient, plugins: PluginService, monkeypatch: pytest.MonkeyPatch
) -> None:
    set_up_as_alice(client)
    client.put(f"{ROOT}/key", json={"key": KEY})
    add_bob(client)
    sign_in(client, "bob")
    assert client.post(f"{ROOT}/results", json=ALBUM).status_code == 409
    monkeypatch.setattr(plugins, "plugins_for", lambda _: ("tavily",))
    assert client.get(f"{ROOT}/results", params=ALBUM).json()["searching"] is False

    response = client.post(f"{ROOT}/results", json=ALBUM)

    assert (response.status_code, response.json()) == (202, None)
    assert client.get(f"{ROOT}/results", params=ALBUM).json()["searching"] is True
