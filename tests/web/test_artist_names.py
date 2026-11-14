"""The artist names API: the Library's artist names, and the links the household chose."""

from fastapi.testclient import TestClient

from medleyplay.application.catalog import CatalogService
from medleyplay.domain.catalog import SourceKey, TrackDetails
from tests.support.api import set_up_as_alice


def _song_by(catalog: CatalogService, artist: str, title: str = "Song") -> None:
    """Add a Library file whose tags name `artist`."""
    catalog.add_track(SourceKey("library", f"1/Music/{title}.m4a"), TrackDetails(title, artist))


def test_the_artist_names_in_the_library_are_listed(
    client: TestClient, catalog: CatalogService
) -> None:
    set_up_as_alice(client)
    _song_by(catalog, "披头士")

    body = client.get("/api/artist-names").json()

    assert body == {
        "names": [
            {
                "name": "披头士",
                "key": "披头士",
                "tracks": 1,
                "look_up": "yes",
                "linked": False,
                "artist_id": None,
                "looked_at": None,
                "candidates": [],
                "suggested": None,
                "finding": False,
            }
        ],
        "artists": [],
    }


def test_a_name_is_linked_to_no_artist_and_then_unlinked(
    client: TestClient, catalog: CatalogService
) -> None:
    set_up_as_alice(client)
    _song_by(catalog, "Blue Room")

    linked = client.put("/api/artist-names/link", json={"name": "Blue Room", "artist_id": None})
    after_link = client.get("/api/artist-names").json()["names"][0]
    unlinked = client.post("/api/artist-names/unlink", json={"name": "Blue Room"})

    assert (linked.status_code, unlinked.status_code) == (204, 204)
    assert (after_link["linked"], after_link["artist_id"]) == (True, None)
    assert client.get("/api/artist-names").json()["names"][0]["linked"] is False


def test_a_name_is_not_linked_to_an_artist_never_named(
    client: TestClient, catalog: CatalogService
) -> None:
    set_up_as_alice(client)
    _song_by(catalog, "披头士")

    linked = client.put("/api/artist-names/link", json={"name": "披头士", "artist_id": "b10bbbfc"})

    assert linked.status_code == 404


def test_names_are_not_looked_up_while_musicbrainz_is_off(client: TestClient) -> None:
    set_up_as_alice(client)

    asked = client.post("/api/artist-names/look-up", json={"names": ["披头士"]})

    assert asked.status_code == 409


def test_the_artist_names_are_for_signed_in_accounts(client: TestClient) -> None:
    assert client.get("/api/artist-names").status_code == 401
