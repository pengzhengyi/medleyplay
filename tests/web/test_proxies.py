"""The proxies API: an admin sets a site's proxy; nothing ever shows its login."""

import pytest
from fastapi.testclient import TestClient

from tests.support.api import add_bob, set_up_as_alice, sign_in
from tests.support.fakes import FakeClock, MemorySecrets

URL = "socks5h://alice:hunter2@127.0.0.1:7890"
SHOWN = {
    "scheme": "socks5h",
    "host": "127.0.0.1",
    "port": 7890,
    "has_login": True,
    "display": "socks5h://127.0.0.1:7890",
}


def _as_bob(client: TestClient) -> None:
    set_up_as_alice(client)
    add_bob(client)
    sign_in(client, "bob")


def test_a_saved_proxy_shows_its_address_and_that_it_has_a_login_but_never_the_login(
    client: TestClient, clock: FakeClock, secrets: MemorySecrets
) -> None:
    set_up_as_alice(client)

    saved = client.put("/api/proxies/bilibili", json={"url": URL})
    read = client.get("/api/proxies/bilibili")

    expected = {**SHOWN, "saved_at": clock.now.isoformat().replace("+00:00", "Z")}
    assert (saved.status_code, saved.json()) == (200, expected)
    assert (read.status_code, read.json()) == (200, expected)
    assert "hunter2" not in saved.text + read.text
    assert secrets.items == {"proxy:bilibili": URL}


def test_a_site_with_no_proxy_answers_null(client: TestClient) -> None:
    set_up_as_alice(client)

    response = client.get("/api/proxies/bilibili")

    assert (response.status_code, response.json()) == (200, None)


def test_removing_a_proxy_answers_204_also_when_there_is_none(
    client: TestClient, secrets: MemorySecrets
) -> None:
    set_up_as_alice(client)
    client.put("/api/proxies/bilibili", json={"url": URL})

    first = client.delete("/api/proxies/bilibili")
    second = client.delete("/api/proxies/bilibili")

    assert (first.status_code, second.status_code) == (204, 204)
    assert client.get("/api/proxies/bilibili").json() is None
    assert secrets.items == {}


@pytest.mark.parametrize(
    ("method", "body"),
    [("GET", None), ("PUT", {"url": URL}), ("DELETE", None)],
)
def test_a_member_may_not_use_the_proxies_api(
    client: TestClient, secrets: MemorySecrets, method: str, body: dict[str, str] | None
) -> None:
    _as_bob(client)

    response = client.request(method, "/api/proxies/bilibili", json=body)

    assert response.status_code == 403
    assert secrets.items == {}


@pytest.mark.parametrize(
    ("method", "body"),
    [("GET", None), ("PUT", {"url": URL}), ("DELETE", None)],
)
def test_nobody_signed_out_may_use_the_proxies_api(
    client: TestClient, method: str, body: dict[str, str] | None
) -> None:
    response = client.request(method, "/api/proxies/bilibili", json=body)

    assert response.status_code == 401


@pytest.mark.parametrize(
    ("method", "body"),
    [("GET", None), ("PUT", {"url": URL}), ("DELETE", None)],
)
def test_a_site_no_plugin_takes_a_proxy_for_is_not_found(
    client: TestClient, secrets: MemorySecrets, method: str, body: dict[str, str] | None
) -> None:
    set_up_as_alice(client)

    response = client.request(method, "/api/proxies/youtube", json=body)

    assert response.status_code == 404
    assert secrets.items == {}


def test_a_proxy_of_another_shape_is_refused_with_why_and_without_echoing_it(
    client: TestClient, secrets: MemorySecrets
) -> None:
    set_up_as_alice(client)

    response = client.put(
        "/api/proxies/bilibili", json={"url": "socks5://alice:hunter2@127.0.0.1:7890"}
    )

    assert response.status_code == 422
    assert "Use socks5h" in response.json()["detail"]
    assert "hunter2" not in response.text
    assert secrets.items == {}


@pytest.mark.parametrize(
    "content",
    [
        b'{"link": "http://alice:hunter2@127.0.0.1:3128"}',
        b'{"url": "http://alice:hunter2@127.0.0.1:3128", "also": "hunter2"}',
        b'{"url": "http://alice:hunter2@127.0.0.1:3128"',
        b'{"url": ["http://alice:hunter2@127.0.0.1:3128"]}',
        b'["http://alice:hunter2@127.0.0.1:3128"]',
        b"http://alice:hunter2@127.0.0.1:3128",
        b'{"http://alice:hunter2@127.0.0.1:3128": 1}',
    ],
    ids=[
        "the wrong key",
        "an extra key",
        "broken JSON",
        "a list for the URL",
        "a list for the body",
        "no JSON",
        "the URL as a key",
    ],
)
def test_a_body_that_is_not_a_proxy_is_refused_with_422_and_never_echoed(
    client: TestClient, content: bytes
) -> None:
    set_up_as_alice(client)

    response = client.put(
        "/api/proxies/bilibili", content=content, headers={"Content-Type": "application/json"}
    )

    assert response.status_code == 422
    assert "hunter2" not in response.text


def test_other_requests_keep_the_detail_that_says_what_is_wrong_with_them(
    client: TestClient,
) -> None:
    set_up_as_alice(client)

    response = client.post("/api/session", json={"username": "alice"})

    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "password"]


def test_a_keychain_that_does_not_answer_is_a_503_and_keeps_no_proxy(
    client: TestClient, secrets: MemorySecrets
) -> None:
    set_up_as_alice(client)
    secrets.unavailable = True

    response = client.put("/api/proxies/bilibili", json={"url": URL})

    assert response.status_code == 503
    secrets.unavailable = False
    assert client.get("/api/proxies/bilibili").json() is None
