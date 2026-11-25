"""The downloads API: where a site Track's Download stands, and adding its file by hand."""

import dataclasses
import time
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from httpx2 import Response
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.manual_downloads import ManualDownloadService
from medleyplay.domain.accounts import AccountId
from medleyplay.domain.catalog import SourceId, SourceKey, TrackDetails
from medleyplay.persistence.schema import SourceRow
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


def _waiting_download(
    client: TestClient, site: Site, units: sessionmaker[Session]
) -> tuple[int, int]:
    """Start downloading a new Track while Offline, so its Job waits; return both ids."""
    site.online.online = False
    track_id = site.catalog.add_track(SourceKey("bilibili", "BV1Xx41117Tz/p1"), TrackDetails("A"))
    with units() as db:
        source_id = db.scalars(select(SourceRow.id).where(SourceRow.track_id == track_id)).one()
    job = site.downloads.start_for(
        AccountId(client.get("/api/me").json()["id"]), SourceId(source_id)
    )
    assert job is not None
    return track_id, job.id


def _failed_download(client: TestClient, *, video: str = "BVrefused") -> tuple[int, int]:
    """Add a part whose Download fails at once, wait for that; return its Track's and Job's ids."""
    added = client.post(
        "/api/links",
        json=ADD_REFUSED | {"link": f"https://www.bilibili.com/video/{video}"},
    ).json()[0]
    _wait_for_failure(client, int(added["job"]["id"]))
    return int(added["track_id"]), int(added["job"]["id"])


def _wait_for_failure(client: TestClient, job_id: int) -> None:
    ends = time.monotonic() + 20
    while client.get(f"/api/jobs/{job_id}").json()["state"] != "failed":
        assert time.monotonic() < ends, "The Download never failed."
        time.sleep(0.05)


def _failed_track(client: TestClient) -> int:
    """Add a part whose Download fails at once, wait for that, and return its Track's id."""
    return _failed_download(client)[0]


def _put(
    client: TestClient, track_id: int, name: str, content: bytes | Iterator[bytes]
) -> Response:
    return client.put(f"/api/tracks/{track_id}/download", params={"name": name}, content=content)


def test_a_failed_download_is_reported_with_its_link_and_why(site_client: TestClient) -> None:
    track_id, job_id = _failed_download(site_client)

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
        "job_id": job_id,
    }


def test_a_failed_download_is_retried_through_the_job_it_names(site_client: TestClient) -> None:
    track_id = _failed_track(site_client)
    failed = site_client.get(f"/api/tracks/{track_id}/download").json()["job_id"]

    retried = site_client.post(f"/api/jobs/{failed}/retry")

    assert retried.status_code == 200
    now = site_client.get(f"/api/tracks/{track_id}/download").json()
    assert now["job_id"] == retried.json()["id"]


def test_dismissing_one_failure_keeps_its_track_and_leaves_other_failures_visible(
    site_client: TestClient,
) -> None:
    track_id, job_id = _failed_download(site_client)
    other_track, other_job = _failed_download(site_client, video="BVSignedIn")

    response = site_client.post("/api/downloads/failed/dismiss", json={"job_ids": [job_id]})

    assert response.status_code == 204
    tracks = {track["id"]: track for track in site_client.get("/api/tracks").json()}
    assert tracks[track_id]["download_failed"] is True
    assert tracks[track_id]["download_failure_job_id"] is None
    assert tracks[other_track]["download_failure_job_id"] == other_job
    assert site_client.get(f"/api/tracks/{track_id}/download").json()["job_id"] == job_id


def test_dismissing_several_failures_leaves_waiting_jobs_alone(
    site_client: TestClient,
    site_services: tuple[Site, Services],
    units: sessionmaker[Session],
) -> None:
    first, first_job = _failed_download(site_client)
    second, second_job = _failed_download(site_client, video="BVSignedIn")
    _, waiting = _waiting_download(site_client, site_services[0], units)

    response = site_client.post(
        "/api/downloads/failed/dismiss", json={"job_ids": [first_job, second_job, waiting]}
    )

    assert response.status_code == 204
    for track_id in (first, second):
        assert site_client.get(f"/api/tracks/{track_id}").json()["download_failure_job_id"] is None
    assert site_client.get(f"/api/jobs/{waiting}").json()["state"] in {"queued", "waiting"}


def test_dismissing_an_earlier_attempt_does_not_hide_a_new_failure(site_client: TestClient) -> None:
    track_id, earlier = _failed_download(site_client)
    new = site_client.post(f"/api/jobs/{earlier}/retry").json()["id"]
    _wait_for_failure(site_client, new)

    response = site_client.post("/api/downloads/failed/dismiss", json={"job_ids": [earlier]})

    assert response.status_code == 204
    assert site_client.get(f"/api/tracks/{track_id}").json()["download_failure_job_id"] == new


def test_the_track_list_marks_a_failed_download_and_names_the_site(site_client: TestClient) -> None:
    track_id, job_id = _failed_download(site_client)

    track = site_client.get(f"/api/tracks/{track_id}").json()

    assert (track["downloaded"], track["download_failed"], track["site"]) == (
        False,
        True,
        "bilibili",
    )
    assert track["download_failure_job_id"] == job_id
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
        "job_id": None,
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
    assert client.get("/api/downloads").status_code == 401


def test_the_downloads_under_way_are_listed_with_their_tracks_and_progress(
    site_client: TestClient, site_services: tuple[Site, Services], units: sessionmaker[Session]
) -> None:
    track_id, job_id = _waiting_download(site_client, site_services[0], units)

    response = site_client.get("/api/downloads")

    assert response.status_code == 200
    [listed] = response.json()
    assert listed["track_id"] == track_id
    assert (listed["job"]["id"], listed["job"]["state"]) == (job_id, "queued")
    assert listed["job"]["waits_for_online"] is True
    assert listed["job"]["progress"] is None


def test_no_download_is_listed_once_it_failed(site_client: TestClient) -> None:
    _failed_track(site_client)

    assert site_client.get("/api/downloads").json() == []
