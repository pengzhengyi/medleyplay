"""An Account resumes an interactive video lookup without looking the video up again."""

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.domain.jobs import JobId, JobState
from medleyplay.persistence.schema import JobRow, SplitOfferStateRow, TrackRow
from medleyplay.web.deps import Services
from tests.support.api import add_bob, sign_in
from tests.support.sites import Site

LOOKUPS = "/api/links/lookups"
CHOICE = {"parts": [{"part": 2, "title": "Side B", "artist": "Blue Room"}]}


def _ready(client: TestClient, site: Site, code: str) -> str:
    job = JobId(client.post(LOOKUPS, json={"link": code}).json()["id"])
    site.wait_for(job, JobState.SUCCEEDED)
    return f"{LOOKUPS}/{job}"


def test_album_queues_each_source_in_order_with_household_album_details(
    site_client: TestClient, site_services: tuple[Site, Services], units: sessionmaker[Session]
) -> None:
    site, _ = site_services
    path = _ready(site_client, site, "BV17x411w7KC")
    album = {"mode": "album", "album": "Studio Sessions", "artist": "Trio", "quality": "30216"}

    result = site_client.post(path, json=album)

    assert result.status_code == 200, result.text
    assert [row["part"] for row in result.json()] == [1, 2, 3]
    with units() as db:
        for number, row in enumerate(result.json(), 1):
            song = db.get_one(TrackRow, row["track_id"])
            job = db.get_one(JobRow, row["job"]["id"])
            assert (song.album, song.album_artist, song.artist) == ("Studio Sessions", "Trio", "")
            assert (song.title, song.track_number, song.kind) == (
                f"Mixtape {number}",
                number,
                "song",
            )
            assert (job.request["part"], job.request["quality"]) == (number, "30216")
    assert site_client.post(path, json=album).status_code == 404


def test_mixed_album_adds_nothing_and_quick_download_skips_existing_edits(
    site_client: TestClient, site_services: tuple[Site, Services], units: sessionmaker[Session]
) -> None:
    site, _ = site_services
    first = _ready(site_client, site, "BV17x411w7KC")
    assert site_client.post(first, json=CHOICE).status_code == 200
    path = _ready(site_client, site, "BV17x411w7KC")

    assert site_client.post(path, json={"mode": "album", "album": "Sessions"}).status_code == 409
    with units() as db:
        assert [(t.title, t.album) for t in db.scalars(select(TrackRow))] == [("Side B", "")]
    result = site_client.post(path, json={"mode": "download"})
    assert [row["part"] for row in result.json()] == [1, 3]
    with units() as db:
        assert len(db.scalars(select(JobRow).where(JobRow.kind == "download_source")).all()) == 3


def test_an_album_uses_only_the_selected_new_parts_in_video_order(
    site_client: TestClient, site_services: tuple[Site, Services], units: sessionmaker[Session]
) -> None:
    site, _ = site_services
    first = _ready(site_client, site, "BV17x411w7KC")
    assert site_client.post(first, json=CHOICE).status_code == 200
    path = _ready(site_client, site, "BV17x411w7KC")

    result = site_client.post(path, json={"mode": "album", "album": "Sessions", "parts": [3, 1]})

    assert result.status_code == 200, result.text
    assert [row["part"] for row in result.json()] == [1, 3]
    with units() as db:
        songs = db.scalars(select(TrackRow).order_by(TrackRow.id)).all()
        assert [(song.title, song.album, song.track_number) for song in songs] == [
            ("Side B", "", None),
            ("Mixtape 1", "Sessions", 1),
            ("Mixtape 3", "Sessions", 2),
        ]


def test_quick_download_refuses_unknown_parts_and_keeps_the_lookup_for_a_valid_subset(
    site_client: TestClient, site_services: tuple[Site, Services]
) -> None:
    site, _ = site_services
    path = _ready(site_client, site, "BV17x411w7KC")

    refused = site_client.post(path, json={"mode": "download", "parts": [2, 4]})
    result = site_client.post(path, json={"mode": "download", "parts": [2]})

    assert refused.status_code == 422
    assert result.status_code == 200, result.text
    assert [row["part"] for row in result.json()] == [2]
    assert site_client.get(path).status_code == 404


def test_quick_download_keeps_a_single_file_whole_without_an_artist_guess(
    site_client: TestClient, site_services: tuple[Site, Services], units: sessionmaker[Session]
) -> None:
    site, _ = site_services
    path = _ready(site_client, site, "BV1Xx41117Tz")
    site.online.online = False
    assert site_client.post(path, json={"mode": "download"}).status_code == 409
    site.online.online = True

    result = site_client.post(path, json={"mode": "download"})

    assert result.status_code == 200, result.text
    with units() as db:
        song = db.get_one(TrackRow, result.json()[0]["track_id"])
        assert song.artist == ""
        assert db.get_one(SplitOfferStateRow, song.id).kept_at is not None


def _assert_private(client: TestClient, job_id: JobId) -> None:
    path = f"{LOOKUPS}/{job_id}"
    assert client.get(LOOKUPS).json() == []
    assert client.get(path).status_code == 404
    assert client.delete(path).status_code == 404
    assert client.post(path, json=CHOICE).status_code == 404
    assert client.post(path, json={"mode": "download"}).status_code == 404
    assert client.get(f"/api/jobs/{job_id}").status_code == 404
    assert client.post(f"/api/jobs/{job_id}/cancel").status_code == 404
    assert client.post(f"/api/jobs/{job_id}/retry").status_code == 404
    assert job_id not in [j["id"] for j in client.get("/api/jobs").json()]


def test_a_saved_lookup_adds_only_the_parts_confirmed_by_its_owner(
    site_client: TestClient, site_services: tuple[Site, Services], units: sessionmaker[Session]
) -> None:
    site, _ = site_services
    add_bob(site_client)
    sign_in(site_client, "bob")
    response = site_client.post(
        LOOKUPS,
        json={"link": "https://www.bilibili.com/video/BV17x411w7KC?p=2&token=private#sharing"},
    )
    assert response.status_code == 202
    job_id = JobId(response.json()["id"])
    path = f"{LOOKUPS}/{job_id}"
    site.wait_for(job_id, JobState.SUCCEEDED)

    with units() as db:
        job = db.get_one(JobRow, job_id)
        assert job.request["link"] == "https://www.bilibili.com/video/BV17x411w7KC?p=2"
        assert db.scalars(select(TrackRow)).all() == []
    sign_in(site_client, "alice")
    _assert_private(site_client, job_id)
    other = site_client.post(
        LOOKUPS, json={"link": "https://www.bilibili.com/video/BV17x411w7KC?p=2"}
    )
    assert other.status_code == 202
    assert other.json()["id"] != job_id

    sign_in(site_client, "bob")
    assert [saved["id"] for saved in site_client.get(LOOKUPS).json()] == [job_id]
    assert len(site_client.get(path).json()["result"]["parts"]) == 3
    assert site_client.post(path, json={"parts": []}).status_code == 422
    site.online.online = False
    assert site_client.post(path, json=CHOICE).status_code == 409
    assert site_client.get(path).json()["result"]["readable"]
    site.online.online = True
    added = site_client.post(path, json=CHOICE)
    assert added.status_code == 200
    assert [part["part"] for part in added.json()] == [2]
    assert site_client.get(LOOKUPS).json() == []
    assert site_client.post(path, json=CHOICE).status_code == 404
    sign_in(site_client, "alice")
    other_id = JobId(other.json()["id"])
    site.wait_for(other_id, JobState.SUCCEEDED)
    parts = site_client.get(f"{LOOKUPS}/{other_id}").json()["result"]["parts"]
    assert parts[1]["track_id"] == added.json()[0]["track_id"]
    duplicate = site_client.post(f"{LOOKUPS}/{other_id}", json=CHOICE)
    assert duplicate.json()[0]["track_id"] == parts[1]["track_id"]


def test_an_unreadable_video_keeps_manual_entry_and_can_be_dismissed(
    site_client: TestClient, site_services: tuple[Site, Services]
) -> None:
    site, _ = site_services
    response = site_client.post(LOOKUPS, json={"link": "https://www.bilibili.com/video/BVdown?p=3"})
    assert response.status_code == 202
    job_id = JobId(response.json()["id"])
    site.wait_for(job_id, JobState.SUCCEEDED)

    path = f"{LOOKUPS}/{job_id}"
    result = site_client.get(path).json()["result"]
    assert (result["readable"], result["reason"], result["parts"][0]["part"]) == (
        False,
        "network",
        3,
    )
    assert site_client.post(path, json={"mode": "download"}).status_code == 422
    assert site_client.delete(path).status_code == 204
    assert site_client.get(LOOKUPS).json() == []
    assert site_client.post(path, json=CHOICE).status_code == 404


def test_no_lookup_operation_can_be_used_signed_out(client: TestClient) -> None:
    assert client.post(LOOKUPS, json={"link": "av170001"}).status_code == 401
    assert client.get(LOOKUPS).status_code == 401
    assert client.get(f"{LOOKUPS}/1").status_code == 401
    assert client.delete(f"{LOOKUPS}/1").status_code == 401
    assert client.post(f"{LOOKUPS}/1", json=CHOICE).status_code == 401
