"""The artist splits API: names written as several artists, to split into each or keep."""

from fastapi.testclient import TestClient

from medleyplay.application.catalog import CatalogService
from medleyplay.domain.catalog import SourceKey, TrackDetails, TrackId
from tests.support.api import set_up_as_alice


def _song_by(catalog: CatalogService, artist: str, title: str = "Melt") -> TrackId:
    """Add the Library file `<title>.m4a`, whose tags name `artist`."""
    return catalog.add_track(
        SourceKey("library", f"1/Music/{title}.m4a"), TrackDetails(title=title, artist=artist)
    )


def test_a_name_written_as_several_artists_is_offered_with_each(
    client: TestClient, catalog: CatalogService
) -> None:
    set_up_as_alice(client)
    _song_by(catalog, "スズム feat. GUMI")

    found = client.get("/api/artist-splits").json()

    assert found == {
        "offers": [
            {
                "written": "スズム feat. GUMI",
                "artists": [
                    {"written": "スズム", "role": "main"},
                    {"written": "GUMI", "role": "featured"},
                ],
                "songs": 1,
                "linked": False,
            }
        ],
        "decided": [],
    }


def test_a_split_name_lists_each_artist_on_its_songs_until_forgotten(
    client: TestClient, catalog: CatalogService
) -> None:
    set_up_as_alice(client)
    song = _song_by(catalog, "GUMI/MAYU")

    split = client.post("/api/artist-splits/split", json={"names": ["GUMI/MAYU"]})
    after_split = client.get(f"/api/tracks/{song}").json()["artists"]
    decided = client.get("/api/artist-splits").json()["decided"]
    client.post("/api/artist-splits/forget", json={"names": ["GUMI/MAYU"]})

    assert split.status_code == 204
    assert after_split == ["GUMI", "MAYU"]
    assert decided == [{"written": "GUMI/MAYU", "split": True}]
    assert client.get(f"/api/tracks/{song}").json()["artists"] == ["GUMI/MAYU"]


def test_a_name_kept_as_written_is_offered_no_more(
    client: TestClient, catalog: CatalogService
) -> None:
    set_up_as_alice(client)
    _song_by(catalog, "GUMI/MAYU")

    client.post("/api/artist-splits/keep", json={"names": ["GUMI/MAYU"]})

    assert client.get("/api/artist-splits").json()["offers"] == []


def test_splitting_a_name_naming_one_artist_is_refused(
    client: TestClient, catalog: CatalogService
) -> None:
    set_up_as_alice(client)
    _song_by(catalog, "AC/DC")

    refused = client.post("/api/artist-splits/split", json={"names": ["AC/DC"]})

    assert refused.status_code == 422
