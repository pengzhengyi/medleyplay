"""An Account resumes an interactive video lookup without looking the video up again."""

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.domain.jobs import JobId, JobState
from medleyplay.persistence.schema import JobRow, TrackRow
from medleyplay.web.deps import Services
from tests.support.api import add_bob, sign_in
from tests.support.sites import Site

LOOKUPS = "/api/links/lookups"
CHOICE = {"parts": [{"part": 2, "title": "Side B", "artist": "Blue Room"}]}


def _assert_private(client: TestClient, job_id: JobId) -> None:
    path = f"{LOOKUPS}/{job_id}"
    assert client.get(LOOKUPS).json() == []
    assert client.get(path).status_code == 404
    assert client.delete(path).status_code == 404
    assert client.post(path, json=CHOICE).status_code == 404
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
    assert site_client.delete(path).status_code == 204
    assert site_client.get(LOOKUPS).json() == []
    assert site_client.post(path, json=CHOICE).status_code == 404


def test_no_lookup_operation_can_be_used_signed_out(client: TestClient) -> None:
    assert client.post(LOOKUPS, json={"link": "av170001"}).status_code == 401
    assert client.get(LOOKUPS).status_code == 401
    assert client.get(f"{LOOKUPS}/1").status_code == 401
    assert client.delete(f"{LOOKUPS}/1").status_code == 401
    assert client.post(f"{LOOKUPS}/1", json=CHOICE).status_code == 401
