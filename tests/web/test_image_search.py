"""Authenticated, explicit picture search with a household key kept outside the database."""

from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.plugins import PluginService
from medleyplay.persistence.schema import ArtistRow, JobRow
from tests.support.api import add_bob, set_up_as_alice, sign_in
from tests.support.fakes import MemorySecrets

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


def _keep_profile(units: sessionmaker[Session], artist_id: str, name: str) -> None:
    with units.begin() as db:
        db.add(
            ArtistRow(
                id=artist_id,
                name=name,
                sort_name=name,
                disambiguation="",
                country="GB",
                found_at=datetime(2026, 11, 1, tzinfo=UTC),
            )
        )


def test_profile_searches_use_only_the_name_and_keep_album_and_same_name_profiles_apart(
    client: TestClient,
    units: sessionmaker[Session],
    plugins: PluginService,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    band = f"{ROOT}/artist/atlas-band"
    singer = f"{ROOT}/artist/atlas-singer"
    _keep_profile(units, "atlas-band", "Atlas")
    _keep_profile(units, "atlas-singer", "Atlas")
    set_up_as_alice(client)
    assert (
        client.put(
            "/api/artists/atlas-band/details",
            json={"shown_as": "Library nickname", "about": "Household note"},
        ).status_code
        == 204
    )
    monkeypatch.setattr(plugins, "plugins_for", lambda _: ("tavily",))
    assert client.get(band).json() == {"configured": False, "name": "Atlas"}
    client.put(f"{ROOT}/key", json={"key": KEY})
    assert client.get(band).json() == {"configured": True, "name": "Atlas"}
    assert client.get(f"{band}/results").json()["searching"] is False
    with units() as db:
        assert db.scalars(select(JobRow)).all() == []

    assert (
        client.post(f"{ROOT}/results", json={"album": "First", "artist": "Atlas"}).status_code
        == 202
    )
    assert client.post(f"{band}/results").status_code == 202
    assert client.post(f"{band}/results").status_code == 202
    assert client.get(f"{band}/results").json()["searching"] is True
    assert client.get(f"{singer}/results").json()["searching"] is False
    assert client.post(f"{singer}/results").status_code == 202

    with units() as db:
        rows = db.scalars(select(JobRow).order_by(JobRow.id)).all()
        assert len({row.target for row in rows}) == 3
        assert [row.request for row in rows] == [
            {"album": "First", "artist": "Atlas", "provider": "tavily"},
            {"album": "", "artist": "Atlas", "provider": "tavily"},
            {"album": "", "artist": "Atlas", "provider": "tavily"},
        ]


def test_an_unavailable_keychain_leaves_the_profile_name_available_for_google(
    client: TestClient, units: sessionmaker[Session], secrets: MemorySecrets
) -> None:
    _keep_profile(units, "atlas-band", "Atlas")
    set_up_as_alice(client)
    assert client.put(f"{ROOT}/key", json={"key": KEY}).status_code == 200
    secrets.unavailable = True

    response = client.get(f"{ROOT}/artist/atlas-band")

    assert response.status_code == 200
    assert response.json() == {"configured": False, "name": "Atlas"}


@pytest.mark.parametrize(("artist_id", "status_code"), [("unknown", 404), ("unnamed", 422)])
def test_no_search_is_queued_for_an_unavailable_or_unnamed_profile(
    client: TestClient, units: sessionmaker[Session], artist_id: str, status_code: int
) -> None:
    _keep_profile(units, "unnamed", " \t ")
    set_up_as_alice(client)
    profile = f"{ROOT}/artist/{artist_id}"

    assert client.get(profile).status_code == status_code
    assert client.post(f"{profile}/results").status_code == status_code
    with units() as db:
        assert db.scalars(select(JobRow)).all() == []
