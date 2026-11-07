"""The devices API: a phone waits, is allowed from the host, signs in, and can be removed."""

import json
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from medleyplay.web import events as events_api
from medleyplay.web.app import create_app
from medleyplay.web.deps import DEVICE_COOKIE, Services
from tests.conftest import TEST_HOST
from tests.support.api import ALICE_SETUP, HOST_PEER, add_bob, set_up_as_alice, sign_in
from tests.support.factories import PASSWORD

PHONE_PEER = ("192.168.1.23", 50001)
SAFARI_ON_IPHONE = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15"
    " (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1"
)


@pytest.fixture
def app(services: Services, tmp_path: Path) -> FastAPI:
    """The app, with a built web client of one page."""
    client_dir = tmp_path / "client"
    client_dir.mkdir()
    (client_dir / "index.html").write_text("<!doctype html><title>medleyplay</title>")
    return create_app(services, allowed_hosts=[TEST_HOST], client_dir=client_dir)


@pytest.fixture
def host(app: FastAPI) -> Iterator[TestClient]:
    """The host's own browser."""
    with TestClient(app, base_url=f"http://{TEST_HOST}", client=HOST_PEER) as client:
        yield client


@pytest.fixture
def phone(app: FastAPI) -> Iterator[TestClient]:
    """Safari on a phone on the LAN."""
    with TestClient(
        app,
        base_url=f"http://{TEST_HOST}",
        client=PHONE_PEER,
        headers={"User-Agent": SAFARI_ON_IPHONE},
    ) as client:
        yield client


@pytest.fixture
def alice_on_host(host: TestClient) -> TestClient:
    """The host's browser, set up and signed in as Alice, the admin."""
    set_up_as_alice(host)
    return host


def waiting_phone(phone: TestClient) -> dict[str, object]:
    """The phone asks to connect, and is told to wait; return what it was told."""
    response = phone.get("/api/device")
    assert response.status_code == 200, response.text
    told: dict[str, object] = response.json()
    assert told["presence"] == "waiting"
    return told


def allowed_phone(phone: TestClient, alice_on_host: TestClient) -> str:
    """The phone asks, and Alice allows it from the host; return its id."""
    waiting_phone(phone)
    waiting_id: str = alice_on_host.get("/api/devices").json()["waiting"][0]["id"]
    response = alice_on_host.post(f"/api/devices/{waiting_id}/allow")
    assert response.status_code == 200, response.text
    return waiting_id


def test_the_host_is_admitted_without_a_device_cookie(alice_on_host: TestClient) -> None:
    response = alice_on_host.get("/api/device")

    assert response.json()["presence"] == "host"
    assert alice_on_host.get("/api/me").status_code == 200


def test_a_new_phone_is_refused_everywhere_but_where_it_asks(
    alice_on_host: TestClient, phone: TestClient
) -> None:
    del alice_on_host  # set up

    response = phone.post("/api/session", json={"username": "alice", "password": PASSWORD})

    assert response.status_code == 403
    assert response.json()["code"] == "device_waiting"


def test_a_waiting_phone_still_gets_the_web_client(
    alice_on_host: TestClient, phone: TestClient
) -> None:
    del alice_on_host  # set up
    waiting_phone(phone)

    response = phone.get("/")

    assert response.status_code == 200
    assert "medleyplay" in response.text


def test_a_phone_waits_with_a_code_and_a_long_lived_http_only_cookie(
    alice_on_host: TestClient, phone: TestClient
) -> None:
    del alice_on_host  # set up

    response = phone.get("/api/device")

    assert response.json()["label"] == "Safari on iPhone"
    assert len(str(response.json()["code"])) == 4
    cookie = response.headers["set-cookie"].lower()
    assert cookie.startswith("medleyplay_device=")
    assert "httponly" in cookie
    assert "samesite=lax" in cookie
    assert f"max-age={400 * 24 * 60 * 60}" in cookie


def test_the_admin_sees_the_waiting_phone_with_its_code_and_address(
    alice_on_host: TestClient, phone: TestClient
) -> None:
    told = waiting_phone(phone)

    waiting = alice_on_host.get("/api/devices").json()["waiting"]

    assert [(w["label"], w["address"], w["code"]) for w in waiting] == [
        ("Safari on iPhone", "192.168.1.23", told["code"])
    ]


def test_an_allowed_phone_signs_in(alice_on_host: TestClient, phone: TestClient) -> None:
    allowed_phone(phone, alice_on_host)

    sign_in(phone, "alice")

    assert phone.get("/api/device").json()["presence"] == "allowed"
    assert phone.get("/api/me").json()["username"] == "alice"


def test_a_phone_turned_away_is_refused(alice_on_host: TestClient, phone: TestClient) -> None:
    waiting_phone(phone)
    waiting_id = alice_on_host.get("/api/devices").json()["waiting"][0]["id"]

    alice_on_host.post(f"/api/devices/{waiting_id}/turn-away")

    assert phone.get("/api/device").json()["presence"] == "refused"
    assert phone.get("/api/me").json()["code"] == "device_refused"


def test_removing_a_phone_signs_it_out_and_makes_it_ask_again(
    alice_on_host: TestClient, phone: TestClient
) -> None:
    device_id = allowed_phone(phone, alice_on_host)
    sign_in(phone, "alice")

    response = alice_on_host.delete(f"/api/devices/{device_id}")

    assert response.status_code == 204
    assert phone.get("/api/me").json()["code"] == "device_waiting"
    assert alice_on_host.get("/api/devices").json()["allowed"] == []


def test_an_admin_names_a_phone(alice_on_host: TestClient, phone: TestClient) -> None:
    device_id = allowed_phone(phone, alice_on_host)

    response = alice_on_host.put(f"/api/devices/{device_id}/name", json={"name": "Mia's phone"})
    listed = alice_on_host.get("/api/devices").json()["allowed"]

    assert response.status_code == 200, response.text
    assert response.json()["name"] == "Mia's phone"
    assert [(d["name"], d["label"]) for d in listed] == [("Mia's phone", "Safari on iPhone")]


def test_naming_a_phone_with_none_leaves_its_label(
    alice_on_host: TestClient, phone: TestClient
) -> None:
    device_id = allowed_phone(phone, alice_on_host)
    alice_on_host.put(f"/api/devices/{device_id}/name", json={"name": "Mia's phone"})

    response = alice_on_host.put(f"/api/devices/{device_id}/name", json={"name": None})

    assert response.json()["name"] is None


def test_naming_a_phone_since_removed_answers_404(
    alice_on_host: TestClient, phone: TestClient
) -> None:
    device_id = allowed_phone(phone, alice_on_host)
    alice_on_host.delete(f"/api/devices/{device_id}")

    response = alice_on_host.put(f"/api/devices/{device_id}/name", json={"name": "Mia's phone"})

    assert response.status_code == 404


def test_a_phone_cannot_remove_itself(alice_on_host: TestClient, phone: TestClient) -> None:
    device_id = allowed_phone(phone, alice_on_host)
    sign_in(phone, "alice")

    response = phone.delete(f"/api/devices/{device_id}")
    listed = phone.get("/api/devices").json()["allowed"]

    assert response.status_code == 409
    assert [(d["id"], d["this_device"]) for d in listed] == [(device_id, True)]


def test_removing_all_from_a_phone_keeps_that_phone(
    alice_on_host: TestClient, phone: TestClient, app: FastAPI
) -> None:
    mine = allowed_phone(phone, alice_on_host)
    with TestClient(app, base_url=f"http://{TEST_HOST}", client=("192.168.1.24", 50002)) as other:
        allowed_phone(other, alice_on_host)
    sign_in(phone, "alice")

    phone.delete("/api/devices")

    assert [d["id"] for d in phone.get("/api/devices").json()["allowed"]] == [mine]


def test_the_phone_that_sets_up_is_allowed(phone: TestClient) -> None:
    assert phone.get("/api/device").json()["presence"] == "admitted"

    response = phone.post("/api/setup", json=ALICE_SETUP)

    assert response.status_code == 201
    assert phone.get("/api/device").json()["presence"] == "allowed"
    assert phone.get("/api/me").json()["username"] == "alice"


def test_a_phone_that_sets_up_is_still_signed_in_when_allowing_it_fails(
    phone: TestClient, services: Services, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fail(*args: object, **kwargs: object) -> None:
        del args, kwargs
        raise RuntimeError

    monkeypatch.setattr(services.devices, "ask", fail)

    response = phone.post("/api/setup", json=ALICE_SETUP)

    assert response.status_code == 201
    monkeypatch.undo()
    assert phone.get("/api/device").json()["presence"] == "allowed"
    assert phone.get("/api/me").json()["username"] == "alice"


@pytest.mark.parametrize(
    "header",
    [
        "Forwarded",
        "X-Forwarded-For",
        "X-Forwarded-Host",
        "X-Forwarded-Proto",
        "X-Real-IP",
        "Via",
        "CF-Connecting-IP",
        "True-Client-IP",
    ],
)
def test_a_forwarded_request_from_loopback_is_not_the_host(
    alice_on_host: TestClient, header: str
) -> None:
    response = alice_on_host.get("/api/me", headers={header: "192.168.1.23"})

    assert response.json()["code"] == "device_waiting"


@pytest.mark.parametrize("path", ["/openapi.json", "/docs", "/redoc"])
def test_the_api_description_is_refused_to_a_waiting_phone(
    alice_on_host: TestClient, phone: TestClient, path: str
) -> None:
    del alice_on_host  # set up
    waiting_phone(phone)

    response = phone.get(path)

    assert response.status_code == 403
    assert response.json()["code"] == "device_waiting"


def test_allow_all_lets_a_new_phone_sign_in(alice_on_host: TestClient, phone: TestClient) -> None:
    revision = alice_on_host.get("/api/devices").json()["revision"]
    alice_on_host.put("/api/devices/setting", json={"admission": "everyone", "revision": revision})

    sign_in(phone, "alice")

    assert phone.get("/api/device").json()["presence"] == "admitted"
    assert alice_on_host.get("/api/devices").json()["allowed"] == []


def test_leaving_allow_all_on_a_phone_keeps_that_phone_in(
    alice_on_host: TestClient, phone: TestClient
) -> None:
    revision = alice_on_host.get("/api/devices").json()["revision"]
    alice_on_host.put("/api/devices/setting", json={"admission": "everyone", "revision": revision})
    sign_in(phone, "alice")

    response = phone.put(
        "/api/devices/setting", json={"admission": "ask", "revision": revision + 1}
    )

    assert response.status_code == 200, response.text
    assert DEVICE_COOKIE in response.cookies
    assert [d["this_device"] for d in response.json()["allowed"]] == [True]
    assert phone.get("/api/me").json()["username"] == "alice"


def test_a_phone_event_stream_ends_once_the_phone_is_no_longer_let_in(
    alice_on_host: TestClient, phone: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(events_api, "SESSION_CHECK_SECONDS", 0.05)
    revision = alice_on_host.get("/api/devices").json()["revision"]
    alice_on_host.put("/api/devices/setting", json={"admission": "everyone", "revision": revision})
    sign_in(phone, "alice")

    with phone.stream("GET", "/api/events") as stream:
        lines = stream.iter_lines()
        assert next(lines) == "event: ready"
        alice_on_host.put(
            "/api/devices/setting", json={"admission": "known", "revision": revision + 1}
        )
        list(lines)  # returns once the stream ends

    assert phone.get("/api/me").json()["code"] == "device_refused"


def test_a_stale_choice_answers_409(alice_on_host: TestClient) -> None:
    revision = alice_on_host.get("/api/devices").json()["revision"]
    alice_on_host.put("/api/devices/setting", json={"admission": "known", "revision": revision})

    response = alice_on_host.put(
        "/api/devices/setting", json={"admission": "everyone", "revision": revision}
    )

    assert response.status_code == 409


def test_a_member_may_not_see_the_devices(alice_on_host: TestClient) -> None:
    add_bob(alice_on_host)
    sign_in(alice_on_host, "bob")

    response = alice_on_host.get("/api/devices")

    assert response.status_code == 403
    assert "code" not in response.json()


def test_an_admins_event_stream_tells_the_waiting_devices(
    alice_on_host: TestClient, phone: TestClient
) -> None:
    told = waiting_phone(phone)

    with alice_on_host.stream("GET", "/api/events") as stream:
        lines = stream.iter_lines()
        for line in lines:
            if line == "event: devices":
                break
        data = json.loads(next(lines).removeprefix("data: "))

    assert [w["code"] for w in data["waiting"]] == [told["code"]]
