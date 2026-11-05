"""The AI API: an admin sets the provider, and nothing ever shows its key."""

import pytest
from fastapi.testclient import TestClient

from medleyplay.domain.ai import MAX_DESCRIPTION, PRESETS
from tests.support.ai import KEY
from tests.support.api import add_bob, set_up_as_alice, sign_in
from tests.support.fakes import FakeClock, MemorySecrets

SETTING = {"base_url": "https://api.deepseek.com", "model": "deepseek-chat", "key": KEY}


def _saved(clock: FakeClock, *, has_key: bool = True) -> dict[str, object]:
    return {
        "base_url": "https://api.deepseek.com",
        "model": "deepseek-chat",
        "has_key": has_key,
        "saved_at": clock.now.isoformat().replace("+00:00", "Z"),
    }


def _as_bob(client: TestClient) -> None:
    set_up_as_alice(client)
    add_bob(client)
    sign_in(client, "bob")


def test_before_it_is_set_up_the_api_shows_no_provider_the_presets_and_the_limit(
    client: TestClient,
) -> None:
    set_up_as_alice(client)

    body = client.get("/api/ai").json()

    assert body["provider"] is None
    assert body["max_description"] == MAX_DESCRIPTION
    assert [(each["name"], each["base_url"], each["model"]) for each in body["presets"]] == [
        (preset.name, preset.base_url, preset.model) for preset in PRESETS
    ]


def test_a_saved_provider_shows_its_address_and_model_and_that_it_has_a_key_but_never_the_key(
    client: TestClient, clock: FakeClock, secrets: MemorySecrets
) -> None:
    set_up_as_alice(client)

    saved = client.put("/api/ai", json=SETTING)
    read = client.get("/api/ai")

    assert (saved.status_code, saved.json()) == (200, _saved(clock))
    assert read.json()["provider"] == _saved(clock)
    assert KEY not in saved.text + read.text
    assert secrets.items == {"ai:key": KEY}


def test_saving_again_without_a_key_keeps_the_key(
    client: TestClient, clock: FakeClock, secrets: MemorySecrets
) -> None:
    set_up_as_alice(client)
    client.put("/api/ai", json=SETTING)

    saved = client.put("/api/ai", json={"base_url": SETTING["base_url"], "model": "other-model"})

    assert saved.json() == {**_saved(clock), "model": "other-model"}
    assert secrets.items == {"ai:key": KEY}


def test_removing_the_key_keeps_the_address_and_model(
    client: TestClient, clock: FakeClock, secrets: MemorySecrets
) -> None:
    set_up_as_alice(client)
    client.put("/api/ai", json=SETTING)

    removed = client.delete("/api/ai/key")

    assert (removed.status_code, removed.json()) == (200, _saved(clock, has_key=False))
    assert secrets.items == {}


def test_removing_the_key_of_a_provider_never_set_up_is_not_found(client: TestClient) -> None:
    set_up_as_alice(client)

    assert client.delete("/api/ai/key").status_code == 404


def test_removing_the_provider_answers_204_also_when_there_is_none(
    client: TestClient, secrets: MemorySecrets
) -> None:
    set_up_as_alice(client)
    client.put("/api/ai", json=SETTING)

    first = client.delete("/api/ai")
    second = client.delete("/api/ai")

    assert (first.status_code, second.status_code) == (204, 204)
    assert client.get("/api/ai").json()["provider"] is None
    assert secrets.items == {}


_ROUTES = [
    ("GET", "/api/ai", None),
    ("PUT", "/api/ai", SETTING),
    ("DELETE", "/api/ai/key", None),
    ("DELETE", "/api/ai", None),
]


@pytest.mark.parametrize(("method", "path", "body"), _ROUTES)
def test_a_member_may_not_use_the_ai_api(
    client: TestClient, secrets: MemorySecrets, method: str, path: str, body: dict[str, str] | None
) -> None:
    _as_bob(client)

    response = client.request(method, path, json=body)

    assert response.status_code == 403
    assert secrets.items == {}


@pytest.mark.parametrize(("method", "path", "body"), _ROUTES)
def test_nobody_signed_out_may_use_the_ai_api(
    client: TestClient, method: str, path: str, body: dict[str, str] | None
) -> None:
    assert client.request(method, path, json=body).status_code == 401


@pytest.mark.parametrize(
    "setting",
    [
        {**SETTING, "base_url": "http://api.deepseek.com"},
        {**SETTING, "base_url": "https://alice:swordfish@api.deepseek.com"},
        {**SETTING, "model": "deepseek chat"},
        {**SETTING, "key": "sk-with a space"},
    ],
    ids=["plain http", "a login in the address", "a model with a space", "a key with a space"],
)
def test_a_setting_that_breaks_a_rule_is_refused_with_why_and_never_echoed(
    client: TestClient, secrets: MemorySecrets, setting: dict[str, str]
) -> None:
    set_up_as_alice(client)

    response = client.put("/api/ai", json=setting)

    assert response.status_code == 422
    assert "swordfish" not in response.text
    assert "sk-with" not in response.text
    assert secrets.items == {}


@pytest.mark.parametrize(
    "content",
    [
        b'{"model": "m", "key": "sk-4f9a1c7e5b2d"}',
        b'{"base_url": "https://api.deepseek.com", "model": "m", "key": "sk-4f9a1c7e5b2d", "x": 1}',
        b'{"base_url": "https://api.deepseek.com", "model": "m", "key": ["sk-4f9a1c7e5b2d"]}',
        b'{"base_url": "https://api.deepseek.com", "model": "m", "key": "sk-4f9a1c7e5b2d"',
        b'["sk-4f9a1c7e5b2d"]',
        b"sk-4f9a1c7e5b2d",
        b'{"sk-4f9a1c7e5b2d": 1}',
    ],
    ids=[
        "no address",
        "an extra key",
        "a list for the key",
        "broken JSON",
        "a list for the body",
        "no JSON",
        "the key as a key",
    ],
)
def test_a_body_that_is_not_a_setting_is_refused_with_422_and_never_echoed(
    client: TestClient, content: bytes
) -> None:
    set_up_as_alice(client)

    response = client.put("/api/ai", content=content, headers={"Content-Type": "application/json"})

    assert response.status_code == 422
    assert KEY not in response.text


def test_a_keychain_that_does_not_answer_is_a_503_and_keeps_no_provider(
    client: TestClient, secrets: MemorySecrets
) -> None:
    set_up_as_alice(client)
    secrets.unavailable = True

    response = client.put("/api/ai", json=SETTING)

    assert response.status_code == 503
    secrets.unavailable = False
    assert client.get("/api/ai").json()["provider"] is None
