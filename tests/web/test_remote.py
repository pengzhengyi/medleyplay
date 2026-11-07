"""The remote play API: the host page plays, and a phone of the same account controls it."""

import json
from collections.abc import Iterator
from typing import Final

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from medleyplay.web.app import create_app
from medleyplay.web.deps import Services
from tests.conftest import TEST_HOST
from tests.support.api import HOST_PEER, add_bob, set_up_as_alice, sign_in

PHONE_PEER = ("192.168.1.23", 50001)
HOST_PAGE: Final = "host-page-0001"
PHONE_PAGE: Final = "phone-page-0001"


def report_playing(**changes: object) -> dict[str, object]:
    """What the host page reports while it plays the first of two songs:

    ```json
    {"entries": [{"key": "a", "track_id": 1}, {"key": "b", "track_id": 2}],
     "position": 0, "status": "playing", "seconds": 12.5, ...}
    ```
    """
    return {
        "page": HOST_PAGE,
        "entries": [{"key": "a", "track_id": 1}, {"key": "b", "track_id": 2}],
        "offset": 0,
        "total": 2,
        "position": 0,
        "status": "playing",
        "shuffled": False,
        "repeat": "off",
        "seconds": 12.5,
        "duration": 200.0,
        "volume": 0.8,
        "muted": False,
    } | changes


@pytest.fixture
def app(services: Services) -> FastAPI:
    return create_app(services, allowed_hosts=[TEST_HOST])


@pytest.fixture
def host(app: FastAPI) -> Iterator[TestClient]:
    """The host's browser, set up and signed in as Alice, with Allow all, so phones get in."""
    with TestClient(app, base_url=f"http://{TEST_HOST}", client=HOST_PEER) as client:
        set_up_as_alice(client)
        revision = client.get("/api/devices").json()["revision"]
        client.put("/api/devices/setting", json={"admission": "everyone", "revision": revision})
        yield client


@pytest.fixture
def phone(app: FastAPI, host: TestClient) -> Iterator[TestClient]:
    """A phone on the LAN, signed in as Alice."""
    del host  # set up
    with TestClient(app, base_url=f"http://{TEST_HOST}", client=PHONE_PEER) as client:
        sign_in(client, "alice")
        yield client


def events_of(lines: Iterator[str]) -> Iterator[tuple[str, object]]:
    """Each event of a stream, as its name and its data."""
    name = ""
    for line in lines:
        if line.startswith("event: "):
            name = line.removeprefix("event: ")
        elif line.startswith("data: "):
            yield name, json.loads(line.removeprefix("data: "))


def next_event(events: Iterator[tuple[str, object]], name: str) -> object:
    """The data of the next event called `name`."""
    for each, data in events:
        if each == name:
            return data
    raise AssertionError(name)


def test_the_host_page_that_plays_becomes_the_speaker(host: TestClient) -> None:
    with host.stream("GET", f"/api/events?page={HOST_PAGE}"):
        response = host.put("/api/remote/report", json=report_playing())

    assert response.status_code == 200, response.text
    assert response.json() == {"speaker": True}


def test_a_page_on_a_phone_cannot_play_for_the_household(phone: TestClient) -> None:
    with phone.stream("GET", f"/api/events?page={PHONE_PAGE}"):
        response = phone.put("/api/remote/report", json=report_playing(page=PHONE_PAGE))

    assert response.status_code == 403


def test_a_phone_hears_what_the_speaker_plays(host: TestClient, phone: TestClient) -> None:
    with host.stream("GET", f"/api/events?page={HOST_PAGE}"):
        host.put("/api/remote/report", json=report_playing())
        with phone.stream("GET", "/api/events") as stream:
            heard = next_event(events_of(stream.iter_lines()), "remote")

    assert isinstance(heard, dict)
    assert heard["page"] == HOST_PAGE
    assert heard["state"]["seconds"] == 12.5
    assert heard["state"]["entries"][0] == {"key": "a", "track_id": 1, "unit": None}
    assert heard["age_ms"] == 0


def test_a_command_from_the_phone_reaches_the_speaker_page(
    host: TestClient, phone: TestClient
) -> None:
    with host.stream("GET", f"/api/events?page={HOST_PAGE}") as stream:
        events = events_of(stream.iter_lines())
        next_event(events, "remote")
        host.put("/api/remote/report", json=report_playing())

        response = phone.post(
            "/api/remote/commands", json={"command": {"kind": "seek", "key": "a", "seconds": 30}}
        )

        command = next_event(events, "command")

    assert response.status_code == 204, response.text
    assert command == {"kind": "seek", "key": "a", "seconds": 30.0}


def test_a_command_with_nothing_playing_on_the_computer_answers_409(phone: TestClient) -> None:
    response = phone.post("/api/remote/commands", json={"command": {"kind": "toggle"}})

    assert response.status_code == 409


@pytest.mark.parametrize(
    "command",
    [
        {"kind": "explode"},
        {"kind": "seek", "key": "a b", "seconds": 1},
        {"kind": "volume", "volume": 2},
        {"kind": "play", "entries": [], "start": 0},
    ],
)
def test_a_command_of_the_wrong_shape_answers_422(
    phone: TestClient, command: dict[str, object]
) -> None:
    response = phone.post("/api/remote/commands", json={"command": command})

    assert response.status_code == 422


def test_a_report_with_too_much_of_the_queue_answers_422(host: TestClient) -> None:
    entries = [{"key": f"k{n}", "track_id": n + 1} for n in range(501)]

    response = host.put("/api/remote/report", json=report_playing(entries=entries, total=501))

    assert response.status_code == 422


def test_the_speaker_is_forgotten_when_its_page_stream_ends(
    host: TestClient, phone: TestClient
) -> None:
    with host.stream("GET", f"/api/events?page={HOST_PAGE}"):
        host.put("/api/remote/report", json=report_playing())

    with phone.stream("GET", "/api/events") as stream:
        heard = next_event(events_of(stream.iter_lines()), "remote")

    assert heard == {"page": None, "state": None, "age_ms": None}


def test_another_account_hears_nothing_of_the_speaker(host: TestClient, app: FastAPI) -> None:
    add_bob(host)
    with (
        host.stream("GET", f"/api/events?page={HOST_PAGE}"),
        TestClient(app, base_url=f"http://{TEST_HOST}", client=PHONE_PEER) as bobs_phone,
    ):
        host.put("/api/remote/report", json=report_playing())
        sign_in(bobs_phone, "bob")
        with bobs_phone.stream("GET", "/api/events") as stream:
            heard = next_event(events_of(stream.iter_lines()), "remote")

    assert heard == {"page": None, "state": None, "age_ms": None}
