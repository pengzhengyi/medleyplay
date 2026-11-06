"""The AI API: an admin keeps the providers in order, and nothing ever shows a key."""

import pytest
from fastapi.testclient import TestClient

from medleyplay.domain.ai import MAX_DESCRIPTION, MAX_PROVIDERS, PRESETS, key_secret
from tests.support.ai import KEY, OLLAMA
from tests.support.api import add_bob, set_up_as_alice, sign_in
from tests.support.fakes import FakeClock, MemorySecrets

DEEPSEEK = {"base_url": "https://api.deepseek.com", "model": "deepseek-flash", "key": KEY}
LOCAL = {"base_url": OLLAMA, "model": "llama3.2"}


def _shown(clock: FakeClock, provider_id: str, *, has_key: bool = True) -> dict[str, object]:
    return {
        "id": provider_id,
        "base_url": "https://api.deepseek.com",
        "model": "deepseek-flash",
        "has_key": has_key,
        "saved_at": clock.now.isoformat().replace("+00:00", "Z"),
        "failure": None,
        "failed_at": None,
    }


def _add(client: TestClient, provider: dict[str, str]) -> str:
    added = client.post("/api/ai/providers", json=provider)
    assert added.status_code == 201
    return str(added.json()["id"])


def _models(client: TestClient) -> list[str]:
    return [each["model"] for each in client.get("/api/ai").json()["providers"]]


def _as_bob(client: TestClient) -> None:
    set_up_as_alice(client)
    add_bob(client)
    sign_in(client, "bob")


def test_before_one_is_set_up_the_api_shows_no_provider_the_presets_and_the_limits(
    client: TestClient,
) -> None:
    set_up_as_alice(client)

    body = client.get("/api/ai").json()

    assert body["providers"] == []
    assert (body["max_providers"], body["max_description"]) == (MAX_PROVIDERS, MAX_DESCRIPTION)
    assert [(each["name"], each["base_url"], each["model"]) for each in body["presets"]] == [
        (preset.name, preset.base_url, preset.model) for preset in PRESETS
    ]


def test_an_added_provider_shows_its_address_and_model_and_that_it_has_a_key_but_never_the_key(
    client: TestClient, clock: FakeClock, secrets: MemorySecrets
) -> None:
    set_up_as_alice(client)

    added = client.post("/api/ai/providers", json=DEEPSEEK)
    read = client.get("/api/ai")

    provider_id = added.json()["id"]
    assert (added.status_code, added.json()) == (201, _shown(clock, provider_id))
    assert read.json()["providers"] == [_shown(clock, provider_id)]
    assert KEY not in added.text + read.text
    assert secrets.items == {key_secret(provider_id): KEY}


def test_providers_are_shown_in_the_order_they_are_asked_and_reordered_by_listing_every_id(
    client: TestClient,
) -> None:
    set_up_as_alice(client)
    deepseek, local = _add(client, DEEPSEEK), _add(client, LOCAL)

    reordered = client.put("/api/ai/order", json={"ids": [local, deepseek]})

    assert [each["model"] for each in reordered.json()] == ["llama3.2", "deepseek-flash"]
    assert _models(client) == ["llama3.2", "deepseek-flash"]


def test_an_order_that_leaves_a_provider_out_is_a_conflict(client: TestClient) -> None:
    set_up_as_alice(client)
    deepseek = _add(client, DEEPSEEK)
    _add(client, LOCAL)

    response = client.put("/api/ai/order", json={"ids": [deepseek]})

    assert response.status_code == 409
    assert _models(client) == ["deepseek-flash", "llama3.2"]


def test_the_same_provider_and_model_twice_is_a_conflict(client: TestClient) -> None:
    set_up_as_alice(client)
    _add(client, DEEPSEEK)

    response = client.post("/api/ai/providers", json=DEEPSEEK)

    assert response.status_code == 409
    assert "set up already" in response.json()["detail"]


def test_replacing_the_key_keeps_the_place_and_never_echoes_the_key(
    client: TestClient, secrets: MemorySecrets
) -> None:
    set_up_as_alice(client)
    deepseek = _add(client, DEEPSEEK)
    _add(client, LOCAL)

    replaced = client.put(f"/api/ai/providers/{deepseek}/key", json={"key": "sk-replaced1234"})

    assert (replaced.status_code, replaced.json()["has_key"]) == (200, True)
    assert "sk-replaced1234" not in replaced.text
    assert secrets.items == {key_secret(deepseek): "sk-replaced1234"}
    assert _models(client) == ["deepseek-flash", "llama3.2"]


def test_changing_the_model_keeps_the_place_and_the_key(
    client: TestClient, secrets: MemorySecrets
) -> None:
    set_up_as_alice(client)
    deepseek = _add(client, DEEPSEEK)
    _add(client, LOCAL)

    changed = client.put(f"/api/ai/providers/{deepseek}/model", json={"model": "deepseek-pro"})

    assert (changed.status_code, changed.json()["model"]) == (200, "deepseek-pro")
    assert _models(client) == ["deepseek-pro", "llama3.2"]
    assert secrets.items == {key_secret(deepseek): KEY}


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [("PUT", "key", {"key": KEY}), ("PUT", "model", {"model": "deepseek-pro"})],
    ids=["replacing its key", "changing its model"],
)
def test_changing_a_provider_that_is_gone_is_not_found(
    client: TestClient, method: str, path: str, body: dict[str, str]
) -> None:
    set_up_as_alice(client)

    response = client.request(method, f"/api/ai/providers/gone/{path}", json=body)

    assert response.status_code == 404


def test_removing_a_provider_answers_204_also_when_it_is_gone_and_forgets_its_key(
    client: TestClient, secrets: MemorySecrets
) -> None:
    set_up_as_alice(client)
    deepseek = _add(client, DEEPSEEK)
    _add(client, LOCAL)

    first = client.delete(f"/api/ai/providers/{deepseek}")
    second = client.delete(f"/api/ai/providers/{deepseek}")

    assert (first.status_code, second.status_code) == (204, 204)
    assert _models(client) == ["llama3.2"]
    assert secrets.items == {}


_ROUTES = [
    ("GET", "/api/ai", None),
    ("POST", "/api/ai/providers", DEEPSEEK),
    ("PUT", "/api/ai/providers/any/key", {"key": KEY}),
    ("PUT", "/api/ai/providers/any/model", {"model": "m"}),
    ("PUT", "/api/ai/order", {"ids": []}),
    ("DELETE", "/api/ai/providers/any", None),
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
    "provider",
    [
        {**DEEPSEEK, "base_url": "http://api.deepseek.com"},
        {**DEEPSEEK, "base_url": "https://alice:swordfish@api.deepseek.com"},
        {**DEEPSEEK, "model": "deepseek chat"},
        {**DEEPSEEK, "key": "sk-with a space"},
    ],
    ids=["plain http", "a login in the address", "a model with a space", "a key with a space"],
)
def test_a_provider_that_breaks_a_rule_is_refused_with_why_and_never_echoed(
    client: TestClient, secrets: MemorySecrets, provider: dict[str, str]
) -> None:
    set_up_as_alice(client)

    response = client.post("/api/ai/providers", json=provider)

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
def test_a_body_that_is_not_a_provider_is_refused_with_422_and_never_echoed(
    client: TestClient, content: bytes
) -> None:
    set_up_as_alice(client)

    response = client.post(
        "/api/ai/providers", content=content, headers={"Content-Type": "application/json"}
    )

    assert response.status_code == 422
    assert KEY not in response.text


def test_a_new_key_that_is_not_one_is_refused_with_422_and_never_echoed(
    client: TestClient,
) -> None:
    set_up_as_alice(client)
    deepseek = _add(client, DEEPSEEK)

    response = client.put(f"/api/ai/providers/{deepseek}/key", json={"key": [KEY]})

    assert response.status_code == 422
    assert KEY not in response.text


def test_a_keychain_that_does_not_answer_is_a_503_and_adds_no_provider(
    client: TestClient, secrets: MemorySecrets
) -> None:
    set_up_as_alice(client)
    secrets.unavailable = True

    response = client.post("/api/ai/providers", json=DEEPSEEK)

    assert response.status_code == 503
    secrets.unavailable = False
    assert client.get("/api/ai").json()["providers"] == []
