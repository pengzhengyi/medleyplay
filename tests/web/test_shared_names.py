"""Names that may name several artists, told apart album by album through the API."""

from fastapi.testclient import TestClient

from medleyplay.application.catalog import CatalogService
from medleyplay.domain.catalog import TrackId
from tests.support.api import set_up_as_alice
from tests.support.factories import SourceKeyFactory, TrackDetailsFactory


def _two_artists_of_the_band(
    client: TestClient, catalog: CatalogService
) -> tuple[TrackId, TrackId]:
    """Add *Intro* and *Outro* by The Band on *Blue*, and make *Outro* another The Band's."""
    intro = catalog.add_track(SourceKeyFactory.bilibili(part=1), TrackDetailsFactory.song("Intro"))
    outro = catalog.add_track(SourceKeyFactory.bilibili(part=2), TrackDetailsFactory.song("Outro"))
    client.put(f"/api/tracks/{outro}/namesake", json={"name": "The Band", "artist_id": None})
    return intro, outro


def _artist_of(client: TestClient, track_id: TrackId) -> str:
    artist_id: str = client.get(f"/api/tracks/{track_id}").json()["artist_ids"][0]
    return artist_id


def test_a_name_naming_several_artists_is_listed_with_its_songs_by_album(
    client: TestClient, catalog: CatalogService
) -> None:
    set_up_as_alice(client)
    intro, outro = _two_artists_of_the_band(client, catalog)

    names = client.get("/api/shared-names").json()["names"]

    first, other = _artist_of(client, intro), _artist_of(client, outro)
    assert names == [
        {
            "name": "The Band",
            "artists": [
                {"artist_id": first, "musicbrainz_id": None, "songs": 1},
                {"artist_id": other, "musicbrainz_id": None, "songs": 1},
            ],
            "known": [],
            "kept": False,
            "waiting": True,
            "albums": [
                {"album": "Blue", "track_ids": [intro], "artist_id": first, "confirmed": False},
                {"album": "Blue", "track_ids": [outro], "artist_id": other, "confirmed": True},
            ],
        }
    ]


def test_an_album_told_apart_is_confirmed(client: TestClient, catalog: CatalogService) -> None:
    set_up_as_alice(client)
    intro, _ = _two_artists_of_the_band(client, catalog)

    put = client.put(
        "/api/shared-names/albums",
        json={
            "name": "The Band",
            "albums": [{"track_ids": [intro], "artist_id": _artist_of(client, intro)}],
        },
    )

    assert put.status_code == 204
    [named] = client.get("/api/shared-names").json()["names"]
    assert named["waiting"] is False


def test_an_album_given_two_artists_is_refused(client: TestClient, catalog: CatalogService) -> None:
    set_up_as_alice(client)
    intro, _ = _two_artists_of_the_band(client, catalog)

    put = client.put(
        "/api/shared-names/albums",
        json={
            "name": "The Band",
            "albums": [
                {
                    "track_ids": [intro],
                    "artist_id": _artist_of(client, intro),
                    "musicbrainz_id": "b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d",
                }
            ],
        },
    )

    assert put.status_code == 422


def test_a_name_kept_as_one_says_so_until_forgotten(
    client: TestClient, catalog: CatalogService
) -> None:
    set_up_as_alice(client)
    _two_artists_of_the_band(client, catalog)

    kept = client.post("/api/shared-names/keep", json={"names": ["The Band"]})
    [named] = client.get("/api/shared-names").json()["names"]
    forgotten = client.post("/api/shared-names/forget", json={"names": ["the band"]})

    assert (kept.status_code, forgotten.status_code) == (204, 204)
    assert named["kept"] is True
    assert client.get("/api/shared-names").json()["names"][0]["kept"] is False
