"""The split offers API: long files a song list was found for, to split or keep as one file."""

from fastapi.testclient import TestClient

from medleyplay.application.catalog import CatalogService
from medleyplay.application.details import DetailsService
from medleyplay.domain.catalog import SourceKey, TrackDetails, TrackId
from medleyplay.domain.video_text import Chapter, VideoText
from tests.support.api import set_up_as_alice

MINUTE = 60_000


def _live(catalog: CatalogService, details: DetailsService) -> TrackId:
    """Add *Live*, a 24-minute file whose video's chapters list six songs of four minutes."""
    track_id = catalog.add_track(
        SourceKey("library", "1/Music/Live.m4a"),
        TrackDetails(title="Live", duration_ms=24 * MINUTE),
    )
    chapters = tuple(Chapter(place * 4 * MINUTE, f"Song {place + 1}") for place in range(6))
    details.read_video_text(track_id, VideoText("Live", "", chapters))
    return track_id


def test_a_long_file_is_offered_with_the_list_its_video_gives(
    client: TestClient, catalog: CatalogService, details: DetailsService
) -> None:
    set_up_as_alice(client)
    live = _live(catalog, details)

    found = client.get("/api/split-offers").json()

    assert found["setting"] == "approval"
    [offered] = found["files"]
    assert (offered["track_id"], offered["title"], offered["has_text"]) == (live, "Live", True)
    assert offered["offer"]["source"] == "video"
    assert offered["offer"]["trusted"] is True
    assert offered["offer"]["doubts"] == []
    assert [song["title"] for song in offered["offer"]["songs"]] == [
        f"Song {place}" for place in range(1, 7)
    ]


def test_a_file_is_split_by_the_offer_seen_and_one_whose_offer_changed_is_left(
    client: TestClient, catalog: CatalogService, details: DetailsService
) -> None:
    set_up_as_alice(client)
    live = _live(catalog, details)
    signature = client.get("/api/split-offers").json()["files"][0]["offer"]["signature"]

    stale = client.post(
        "/api/split-offers/split", json={"files": [{"track_id": live, "signature": "0,1"}]}
    )
    done = client.post(
        "/api/split-offers/split", json={"files": [{"track_id": live, "signature": signature}]}
    )

    assert stale.json() == {"split": 0, "left": 1}
    assert done.json() == {"split": 1, "left": 0}
    assert client.get("/api/split-offers").json()["files"] == []


def test_a_file_kept_as_one_is_offered_no_more(
    client: TestClient, catalog: CatalogService, details: DetailsService
) -> None:
    set_up_as_alice(client)
    live = _live(catalog, details)

    kept = client.post("/api/split-offers/keep", json={"track_ids": [live]})

    assert kept.json() == {"kept": 1}
    assert client.get("/api/split-offers").json()["files"] == []


def test_nothing_is_split_or_kept_without_naming_a_file(client: TestClient) -> None:
    set_up_as_alice(client)

    assert client.post("/api/split-offers/split", json={"files": []}).status_code == 422
    assert client.post("/api/split-offers/keep", json={"track_ids": []}).status_code == 422


def test_split_offers_are_for_signed_in_accounts(client: TestClient) -> None:
    assert client.get("/api/split-offers").status_code == 401
    assert client.post("/api/split-offers/keep", json={"track_ids": [1]}).status_code == 401
