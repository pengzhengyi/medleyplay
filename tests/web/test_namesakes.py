"""Telling two artists of one name apart, song by song, through the API."""

from fastapi.testclient import TestClient

from medleyplay.application.catalog import CatalogService
from medleyplay.domain.catalog import TrackId
from tests.support.api import set_up_as_alice
from tests.support.factories import SourceKeyFactory, TrackDetailsFactory


def _two_songs(catalog: CatalogService) -> tuple[TrackId, TrackId]:
    """Add two songs by The Band on *Blue*."""
    return (
        catalog.add_track(SourceKeyFactory.bilibili(part=1), TrackDetailsFactory.song("Intro")),
        catalog.add_track(SourceKeyFactory.bilibili(part=2), TrackDetailsFactory.song("Outro")),
    )


def test_a_song_is_bound_to_another_artist_called_its_artists_name(
    client: TestClient, catalog: CatalogService
) -> None:
    set_up_as_alice(client)
    chosen, _ = _two_songs(catalog)
    [first] = client.get(f"/api/tracks/{chosen}/details").json()["artists"]

    put = client.put(f"/api/tracks/{chosen}/namesake", json={"name": "The Band", "artist_id": None})

    assert put.status_code == 200
    [artist] = put.json()["artists"]
    assert artist["artist_id"] != first["artist_id"]
    assert artist["namesakes"] == [
        {"artist_id": first["artist_id"], "songs": 1, "albums": ["Blue"], "linked": None}
    ]


def test_the_artist_names_list_every_artist_a_name_names(
    client: TestClient, catalog: CatalogService
) -> None:
    set_up_as_alice(client)
    chosen, kept = _two_songs(catalog)
    client.put(f"/api/tracks/{chosen}/namesake", json={"name": "The Band", "artist_id": None})

    [named] = client.get("/api/artist-names").json()["names"]

    ids = {client.get(f"/api/tracks/{each}").json()["artist_ids"][0] for each in (kept, chosen)}
    assert len(named["artist_ids"]) == 2
    assert set(named["artist_ids"]) == ids
    assert named["artist_ids"][0] == client.get(f"/api/tracks/{kept}").json()["artist_ids"][0]


def test_choosing_an_artist_not_called_the_name_is_not_found(
    client: TestClient, catalog: CatalogService
) -> None:
    set_up_as_alice(client)
    chosen, _ = _two_songs(catalog)

    put = client.put(
        f"/api/tracks/{chosen}/namesake", json={"name": "The Band", "artist_id": "0" * 32}
    )

    assert put.status_code == 404


def test_choosing_for_a_name_the_song_does_not_write_is_refused(
    client: TestClient, catalog: CatalogService
) -> None:
    set_up_as_alice(client)
    chosen, _ = _two_songs(catalog)

    put = client.put(f"/api/tracks/{chosen}/namesake", json={"name": "Jay", "artist_id": None})

    assert put.status_code == 422
