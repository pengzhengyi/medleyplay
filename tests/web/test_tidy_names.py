"""The names-to-tidy API: artist names with more than the name in them, tidied or kept."""

from dataclasses import replace

from fastapi.testclient import TestClient

from medleyplay.application.catalog import CatalogService
from medleyplay.domain.catalog import TrackId
from tests.support.api import set_up_as_alice
from tests.support.factories import SourceKeyFactory, TrackDetailsFactory

JAY: str = "周杰伦2000年发行首张个人"


def _song_by(catalog: CatalogService, artist: str, part: int = 1) -> TrackId:
    """Add one Bilibili Track whose video names `artist`."""
    details = replace(TrackDetailsFactory.song(), artist=artist)
    return catalog.add_track(SourceKeyFactory.bilibili(part=part), details)


def test_the_names_to_tidy_are_listed_with_their_tidy_form(
    client: TestClient, catalog: CatalogService
) -> None:
    set_up_as_alice(client)
    track_id = _song_by(catalog, JAY)

    body = client.get("/api/names-to-tidy").json()

    assert body == {
        "names": [
            {
                "written": JAY,
                "name": "周杰伦",
                "year": 2000,
                "fields": ["artist"],
                "track_ids": [track_id],
                "years_differ": 0,
            }
        ]
    }


def test_a_name_is_tidied_on_its_tracks(client: TestClient, catalog: CatalogService) -> None:
    set_up_as_alice(client)
    track_id = _song_by(catalog, JAY)

    tidied = client.post("/api/names-to-tidy/tidy", json={"written": JAY})

    assert tidied.json() == {"changed": 1}
    track = client.get(f"/api/tracks/{track_id}").json()
    assert (track["artist"], track["year"]) == ("周杰伦", 2000)


def test_a_name_kept_as_written_leaves_the_list(
    client: TestClient, catalog: CatalogService
) -> None:
    set_up_as_alice(client)
    _song_by(catalog, JAY)

    kept = client.post("/api/names-to-tidy/keep", json={"written": JAY})

    assert kept.status_code == 204
    assert client.get("/api/names-to-tidy").json() == {"names": []}


def test_tidying_a_name_no_track_shows_is_not_found(client: TestClient) -> None:
    set_up_as_alice(client)

    tidied = client.post("/api/names-to-tidy/tidy", json={"written": JAY})

    assert tidied.status_code == 404


def test_a_name_with_nothing_to_tidy_is_refused(client: TestClient) -> None:
    set_up_as_alice(client)

    tidied = client.post("/api/names-to-tidy/tidy", json={"written": "The Band"})

    assert tidied.status_code == 422


def test_the_names_to_tidy_are_for_signed_in_accounts(client: TestClient) -> None:
    assert client.get("/api/names-to-tidy").status_code == 401
