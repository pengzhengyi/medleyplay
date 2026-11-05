"""The links API: looking a link up, adding its parts, and playing them once downloaded."""

import time

import pytest
from fastapi.testclient import TestClient

from tests.support.api import set_up_as_alice
from tests.support.fakes import OnlineSwitch

NIGHT_DRIVE = "https://www.bilibili.com/video/BV1Xx41117Tz"
ADD = {"link": NIGHT_DRIVE, "parts": [{"part": 1, "title": "Night Drive", "artist": "Blue Room"}]}


def test_a_lookup_answers_the_video(site_client: TestClient) -> None:
    response = site_client.post("/api/links/lookup", json={"link": NIGHT_DRIVE})

    assert response.status_code == 200
    assert response.json() == {
        "kind": "bilibili",
        "video": "BV1Xx41117Tz",
        "title": "【MV】Night Drive",
        "uploader": "Blue Room",
        "parts": [{"part": 1, "title": "Night Drive", "duration_ms": 1000, "track_id": None}],
        "qualities": [
            {"id": "30280", "label": "192 kbps", "kbps": 192},
            {"id": "30232", "label": "132 kbps", "kbps": 132},
            {"id": "30216", "label": "64 kbps", "kbps": 64},
        ],
        "readable": True,
        "reason": None,
        "message": "",
    }


def test_a_bare_code_looks_up_its_video(site_client: TestClient) -> None:
    response = site_client.post("/api/links/lookup", json={"link": "BV1Xx41117Tz"})

    assert response.status_code == 200
    assert response.json()["video"] == "BV1Xx41117Tz"


@pytest.mark.parametrize(
    "link", ["https://evil.example/video/BV1Xx41117Tz", "https://www.bilibili.com/"]
)
def test_a_link_that_is_not_a_bilibili_video_answers_422_with_why(
    site_client: TestClient, link: str
) -> None:
    response = site_client.post("/api/links/lookup", json={"link": link})

    assert response.status_code == 422
    assert response.json()["detail"]


def test_a_video_that_cannot_be_read_answers_readable_false_with_why(
    site_client: TestClient,
) -> None:
    response = site_client.post(
        "/api/links/lookup", json={"link": "https://www.bilibili.com/video/BVgone?p=2"}
    )

    assert response.status_code == 200
    assert response.json() == {
        "kind": "bilibili",
        "video": "BVgone",
        "title": "",
        "uploader": "",
        "parts": [{"part": 2, "title": "", "duration_ms": None, "track_id": None}],
        "qualities": [],
        "readable": False,
        "reason": "gone",
        "message": "The video was removed.",
    }


def test_a_video_that_cannot_be_read_is_added_on_the_details_given(
    site_client: TestClient,
) -> None:
    response = site_client.post(
        "/api/links",
        json={
            "link": "https://www.bilibili.com/video/BVdown",
            "parts": [{"part": 2, "title": "Side B", "artist": "Blue Room"}],
        },
    )

    assert response.status_code == 200
    track = site_client.get(f"/api/tracks/{response.json()[0]['track_id']}").json()
    assert (track["title"], track["artist"], track["duration_ms"]) == ("Side B", "Blue Room", None)


def test_adding_answers_the_tracks_and_their_downloads_and_again_the_same(
    site_client: TestClient,
) -> None:
    first = site_client.post("/api/links", json=ADD)
    again = site_client.post("/api/links", json=ADD)

    assert first.status_code == again.status_code == 200
    added = first.json()[0]
    assert (added["part"], added["job"]["kind"], added["job"]["target"]) == (
        1,
        "download_source",
        f"source:{added['source_id']}",
    )
    assert [(a["track_id"], a["source_id"]) for a in again.json()] == [
        (added["track_id"], added["source_id"])
    ]


def test_an_added_track_plays_once_its_download_finishes(site_client: TestClient) -> None:
    added = site_client.post("/api/links", json=ADD).json()[0]

    answer = _played_once_ready(site_client, added["track_id"])
    audio = site_client.get(f"/api/sources/{added['source_id']}/audio")

    assert answer == {
        "state": "ready",
        "source_id": added["source_id"],
        "media_type": "audio/mp4",
        "audio_url": f"/api/sources/{added['source_id']}/audio",
        "start_ms": None,
        "end_ms": None,
    }
    assert (audio.status_code, audio.headers["content-type"]) == (200, "audio/mp4")
    assert audio.content.startswith(b"BV1Xx41117Tz/p1")


def _played_once_ready(client: TestClient, track_id: int) -> dict[str, object]:
    ends = time.monotonic() + 20
    while time.monotonic() < ends:
        answer: dict[str, object] = client.post(f"/api/tracks/{track_id}/playback").json()
        if answer["state"] == "ready":
            return answer
        time.sleep(0.05)
    raise AssertionError(answer)


def test_offline_looking_a_link_up_or_adding_it_is_a_conflict_coded_offline(
    client: TestClient, online_switch: OnlineSwitch
) -> None:
    set_up_as_alice(client)
    online_switch.online = False

    looked_up = client.post("/api/links/lookup", json={"link": NIGHT_DRIVE})
    added = client.post("/api/links", json=ADD)

    assert (looked_up.status_code, looked_up.json()["code"]) == (409, "offline")
    assert (added.status_code, added.json()["code"]) == (409, "offline")
