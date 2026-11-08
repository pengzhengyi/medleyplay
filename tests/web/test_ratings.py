"""The ratings API: previewing and importing your Rate Your Music export, and your export."""

import csv
import io

from fastapi.testclient import TestClient

from medleyplay.application.catalog import CatalogService
from medleyplay.domain.catalog import TrackId
from medleyplay.domain.rym import MAX_EXPORT_BYTES
from tests.support.api import add_bob, set_up_as_alice, sign_in
from tests.support.factories import SourceKeyFactory, TrackDetailsFactory
from tests.support.rym import EXPORT_2020

CSV = {"Content-Type": "text/csv"}


def _bremen(catalog: CatalogService) -> TrackId:
    """Add *Bremen* by ハチ, which `EXPORT_2020` rates 5 stars."""
    return catalog.add_track(SourceKeyFactory.bilibili(), TrackDetailsFactory.album_file())


def test_the_preview_answers_what_importing_would_change(
    client: TestClient, catalog: CatalogService
) -> None:
    set_up_as_alice(client)
    _bremen(catalog)

    answer = client.post("/api/ratings/import/preview", content=EXPORT_2020.encode(), headers=CSV)

    assert answer.status_code == 200
    assert answer.json() == {
        "albums": 3,
        "matched_albums": 1,
        "songs": 1,
        "unmatched": [
            {"artist": "Tony Allen", "album": "Film of Life"},
            {"artist": "スズム", "album": "八日"},
        ],
        "playlists": [],
        "replaced_albums": 0,
    }
    assert client.get("/api/tracks").json()[0]["album_rating"] is None


def test_importing_gives_your_songs_their_albums_rating(
    client: TestClient, catalog: CatalogService
) -> None:
    set_up_as_alice(client)
    track_id = _bremen(catalog)

    answer = client.post("/api/ratings/import", content=EXPORT_2020.encode(), headers=CSV)

    assert (answer.status_code, answer.json()["songs"]) == (200, 1)
    track = client.get(f"/api/tracks/{track_id}").json()
    assert (track["rating"], track["album_rating"]) == (None, 5)


def test_forgetting_the_import_takes_its_album_ratings_away(
    client: TestClient, catalog: CatalogService
) -> None:
    set_up_as_alice(client)
    track_id = _bremen(catalog)
    client.post("/api/ratings/import", content=EXPORT_2020.encode(), headers=CSV)

    answer = client.delete("/api/ratings/import")

    assert answer.status_code == 204
    assert client.get(f"/api/tracks/{track_id}").json()["album_rating"] is None


def test_an_export_this_server_cannot_read_is_refused_saying_why(client: TestClient) -> None:
    set_up_as_alice(client)

    answer = client.post("/api/ratings/import/preview", content=b"Artist,Album\n", headers=CSV)

    assert answer.status_code == 422
    assert "'Artist'" in answer.json()["detail"]


def test_an_export_over_its_size_is_refused_before_it_is_read(client: TestClient) -> None:
    set_up_as_alice(client)

    answer = client.post(
        "/api/ratings/import/preview", content=b" " * (MAX_EXPORT_BYTES + 1), headers=CSV
    )

    assert answer.status_code == 413


def test_an_albums_rating_and_review_are_found_by_its_library_name(client: TestClient) -> None:
    set_up_as_alice(client)
    client.post("/api/ratings/import", content=EXPORT_2020.encode(), headers=CSV)

    found = client.get(
        "/api/album-rating", params={"artist": "Tony Allen", "album": "Film of Life"}
    )
    missing = client.get("/api/album-rating", params={"artist": "Tony Allen", "album": "Lagos"})

    assert found.json() == {"stars": 4, "note": "Warm & loose."}
    assert missing.json() is None


def test_your_ratings_export_as_a_csv_file_a_spreadsheet_opens(
    client: TestClient, catalog: CatalogService
) -> None:
    set_up_as_alice(client)
    track_id = _bremen(catalog)
    client.put(f"/api/tracks/{track_id}/rating", json={"rating": 3})

    answer = client.get("/api/ratings/export")

    assert answer.status_code == 200
    assert answer.headers["content-type"] == "text/csv; charset=utf-8"
    assert answer.headers["content-disposition"] == (
        'attachment; filename="medleyplay-ratings-2026-01-01.csv"'
    )
    assert answer.content.startswith(b"\xef\xbb\xbf")
    rows = list(csv.reader(io.StringIO(answer.content.decode("utf-8-sig"))))
    assert rows == [
        ["Rated", "Artist", "Album", "Title", "Stars", "Review"],
        ["song", "ハチ", "Bremen", "Bremen", "3", ""],
    ]


def test_an_import_is_the_importing_accounts_alone(
    client: TestClient, catalog: CatalogService
) -> None:
    set_up_as_alice(client)
    track_id = _bremen(catalog)
    client.post("/api/ratings/import", content=EXPORT_2020.encode(), headers=CSV)
    add_bob(client)

    sign_in(client, "bob")

    assert client.get(f"/api/tracks/{track_id}").json()["album_rating"] is None
    assert client.get("/api/ratings/export").text.splitlines()[1:] == []


def test_the_import_kept_answers_how_many_albums_it_has(client: TestClient) -> None:
    set_up_as_alice(client)
    before = client.get("/api/ratings/import").json()
    client.post("/api/ratings/import", content=EXPORT_2020.encode(), headers=CSV)

    after = client.get("/api/ratings/import").json()

    assert (before, after) == ({"albums": 0}, {"albums": 3})
