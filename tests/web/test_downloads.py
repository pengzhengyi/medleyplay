"""The downloads API: where a site Track's Download stands, and adding its file by hand."""

import dataclasses
import time
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from httpx2 import Response
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.manual_downloads import ManualDownloadService
from medleyplay.domain.catalog import SourceKey, TrackDetails
from medleyplay.web.deps import Services
from tests.support.audio import Song, wav_bytes
from tests.support.fakes import FakeClock
from tests.support.sites import Site
from tests.web.conftest import signed_in_client

ADD_REFUSED = {
    "link": "https://www.bilibili.com/video/BVrefused",
    "parts": [{"part": 1, "title": "Night Drive", "artist": "Blue Room"}],
}
TWO_SECONDS = wav_bytes(Song(seconds=2))
SMALL_LIMIT = 1000


@pytest.fixture
def small_limit_client(
    site_services: tuple[Site, Services], units: sessionmaker[Session], clock: FakeClock
) -> Iterator[TestClient]:
    """A client of a server that takes files of at most `SMALL_LIMIT` bytes."""
    site, services = site_services
    limited = ManualDownloadService(
        units, clock, site.jobs, site.downloads.folder, max_bytes=SMALL_LIMIT
    )
    yield from signed_in_client(dataclasses.replace(services, manual_downloads=limited))


def _failed_track(client: TestClient) -> int:
    """Add a part whose Download fails at once, wait for that, and return its Track's id."""
    added = client.post("/api/links", json=ADD_REFUSED).json()[0]
    ends = time.monotonic() + 20
    while client.get(f"/api/jobs/{added['job']['id']}").json()["state"] != "failed":
        assert time.monotonic() < ends, "The Download never failed."
        time.sleep(0.05)
    return int(added["track_id"])


def _put(
    client: TestClient, track_id: int, name: str, content: bytes | Iterator[bytes]
) -> Response:
    return client.put(f"/api/tracks/{track_id}/download", params={"name": name}, content=content)


def test_a_failed_download_is_reported_with_its_link_and_why(site_client: TestClient) -> None:
    track_id = _failed_track(site_client)

    response = site_client.get(f"/api/tracks/{track_id}/download")

    assert response.status_code == 200
    assert response.json() == {
        "track_id": track_id,
        "source_id": response.json()["source_id"],
        "kind": "bilibili",
        "link": "https://www.bilibili.com/video/BVrefused?p=1",
        "status": "failed",
        "message": "Bilibili refused the login.",
        "backend": None,
    }


def test_the_track_list_marks_a_failed_download_and_names_the_site(site_client: TestClient) -> None:
    track_id = _failed_track(site_client)

    track = site_client.get(f"/api/tracks/{track_id}").json()

    assert (track["downloaded"], track["download_failed"], track["site"]) == (
        False,
        True,
        "bilibili",
    )
    listed = next(each for each in site_client.get("/api/tracks").json() if each["id"] == track_id)
    assert listed == track


def test_a_track_without_a_site_source_has_no_download_to_report(
    site_client: TestClient, site_services: tuple[Site, Services]
) -> None:
    library = site_services[0].catalog.add_track(SourceKey("library", "1/a.wav"), TrackDetails("A"))

    response = site_client.get(f"/api/tracks/{library}/download")

    assert response.status_code == 409


def test_a_track_that_does_not_exist_has_no_download_to_report(site_client: TestClient) -> None:
    assert site_client.get("/api/tracks/404/download").status_code == 404


def test_a_file_in_the_body_becomes_the_tracks_download_and_plays(site_client: TestClient) -> None:
    track_id = _failed_track(site_client)

    response = _put(site_client, track_id, "night-drive.wav", TWO_SECONDS)

    assert response.status_code == 200
    assert response.json() | {"source_id": 0} == {
        "track_id": track_id,
        "source_id": 0,
        "kind": "bilibili",
        "link": "https://www.bilibili.com/video/BVrefused?p=1",
        "status": "downloaded",
        "message": "",
        "backend": "manual",
    }
    played = site_client.post(f"/api/tracks/{track_id}/playback").json()
    audio = site_client.get(played["audio_url"])
    assert (played["state"], played["media_type"]) == ("ready", "audio/wav")
    assert audio.content == TWO_SECONDS
    track = site_client.get(f"/api/tracks/{track_id}").json()
    assert (track["downloaded"], track["download_failed"]) == (True, False)


def test_a_file_sent_in_chunks_is_kept_whole(site_client: TestClient) -> None:
    track_id = _failed_track(site_client)
    chunks = (TWO_SECONDS[start : start + 500] for start in range(0, len(TWO_SECONDS), 500))

    response = _put(site_client, track_id, "night-drive.wav", chunks)

    assert response.status_code == 200
    source_id = response.json()["source_id"]
    assert site_client.get(f"/api/sources/{source_id}/audio").content == TWO_SECONDS


def test_a_file_works_offline_since_nothing_contacts_the_site(
    site_client: TestClient, site_services: tuple[Site, Services]
) -> None:
    track_id = _failed_track(site_client)
    site_services[0].online.online = False

    response = _put(site_client, track_id, "night-drive.wav", TWO_SECONDS)

    assert response.status_code == 200


def test_a_file_declared_larger_than_the_limit_is_refused_with_413(
    small_limit_client: TestClient,
) -> None:
    track_id = _failed_track(small_limit_client)

    response = _put(small_limit_client, track_id, "night-drive.wav", bytes(SMALL_LIMIT + 1))

    assert response.status_code == 413
    assert response.json()["detail"]


def test_a_file_that_grows_past_the_limit_while_it_arrives_is_refused_with_413(
    small_limit_client: TestClient,
) -> None:
    track_id = _failed_track(small_limit_client)
    chunks = (bytes(400) for _ in range(3))

    response = _put(small_limit_client, track_id, "night-drive.wav", chunks)

    assert response.status_code == 413


@pytest.mark.parametrize(
    ("name", "content"),
    [
        ("notes.txt", TWO_SECONDS),
        ("night-drive", TWO_SECONDS),
        ("night-drive.mp3", b"This is a note, not music."),
        ("night-drive.wav", b""),
    ],
    ids=["another type", "no extension", "not audio", "empty"],
)
def test_a_file_that_is_not_audio_the_player_serves_is_refused_with_422(
    site_client: TestClient, name: str, content: bytes
) -> None:
    track_id = _failed_track(site_client)

    response = _put(site_client, track_id, name, content)

    assert response.status_code == 422
    assert response.json()["detail"]
    assert site_client.get(f"/api/tracks/{track_id}").json()["downloaded"] is False


def test_a_request_without_the_files_name_is_refused_with_422(site_client: TestClient) -> None:
    track_id = _failed_track(site_client)

    response = site_client.put(f"/api/tracks/{track_id}/download", content=TWO_SECONDS)

    assert response.status_code == 422


def test_a_track_without_a_site_source_takes_no_file_and_answers_409(
    site_client: TestClient, site_services: tuple[Site, Services]
) -> None:
    library = site_services[0].catalog.add_track(SourceKey("library", "1/a.wav"), TrackDetails("A"))

    assert _put(site_client, library, "night-drive.wav", TWO_SECONDS).status_code == 409


def test_a_track_that_does_not_exist_takes_no_file_and_answers_404(site_client: TestClient) -> None:
    assert _put(site_client, 404, "night-drive.wav", TWO_SECONDS).status_code == 404


def test_the_downloads_routes_need_a_signed_in_account(client: TestClient) -> None:
    assert client.get("/api/tracks/1/download").status_code == 401
    assert _put(client, 1, "night-drive.wav", TWO_SECONDS).status_code == 401
