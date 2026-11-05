"""The enrichers API: any Account asks about a Track, an admin asks about all and resets."""

import dataclasses
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.domain.jobs import JobId, JobState
from medleyplay.web.app import create_app
from medleyplay.web.deps import Services
from tests.conftest import TEST_HOST
from tests.support.api import add_bob, set_up_as_alice, sign_in
from tests.support.enrichment import Enriching, running_enrichment
from tests.support.fakes import FakeClock

NAME = "bilibili-details"
RECORDED = "BV1AC4y1L7Yi"


@pytest.fixture
def enriching(
    units: sessionmaker[Session], clock: FakeClock, tmp_path: Path
) -> Iterator[Enriching]:
    with running_enrichment(units, clock, tmp_path / "data") as running:
        yield running


@pytest.fixture
def enrichers_client(enriching: Enriching, services: Services) -> Iterator[TestClient]:
    """A client of a server whose enricher plugin is on."""
    on = dataclasses.replace(
        services,
        plugins=enriching.plugins,
        jobs=enriching.jobs,
        catalog=enriching.catalog,
        enrichment=enriching.enrichment,
    )
    app = create_app(on, allowed_hosts=[TEST_HOST])
    with TestClient(app, base_url=f"http://{TEST_HOST}") as test_client:
        yield test_client


def test_the_enricher_shows_that_it_is_on_and_which_tracks_it_may_be_asked_about(
    enrichers_client: TestClient, enriching: Enriching
) -> None:
    set_up_as_alice(enrichers_client)
    eligible = enriching.add_site_track(RECORDED)
    enriching.add_file_track("Night Drive.m4a")

    body = enrichers_client.get(f"/api/enrichers/{NAME}").json()

    assert body == {"name": NAME, "available": True, "stopped": None, "eligible": [eligible]}


def test_with_the_plugin_off_the_enricher_shows_as_unavailable_with_no_track(
    client: TestClient,
) -> None:
    set_up_as_alice(client)

    body = client.get(f"/api/enrichers/{NAME}").json()

    assert body == {"name": NAME, "available": False, "stopped": None, "eligible": []}


def test_asking_with_the_plugin_off_is_unavailable(client: TestClient) -> None:
    set_up_as_alice(client)

    response = client.post(f"/api/enrichers/{NAME}/tracks/1")

    assert (response.status_code, response.json()["detail"]) == (503, f"{NAME} is turned off.")


def test_an_enricher_that_does_not_exist_is_not_found_without_repeating_its_name(
    client: TestClient,
) -> None:
    set_up_as_alice(client)

    response = client.get("/api/enrichers/acoustid")

    assert (response.status_code, response.json()) == (
        404,
        {"detail": "There is no such enricher."},
    )


def test_asking_about_a_track_queues_a_job_for_it_and_asking_again_returns_that_job(
    enrichers_client: TestClient, enriching: Enriching
) -> None:
    alice = set_up_as_alice(enrichers_client)
    track_id = enriching.add_site_track(RECORDED)

    first = enrichers_client.post(f"/api/enrichers/{NAME}/tracks/{track_id}")
    again = enrichers_client.post(f"/api/enrichers/{NAME}/tracks/{track_id}")

    body = first.json()
    assert (first.status_code, body["kind"], body["target"], body["requested_by"]) == (
        200,
        "enrich_track",
        f"track:{track_id}",
        alice["id"],
    )
    assert again.json()["id"] == body["id"]
    enriching.wait_for(JobId(body["id"]), JobState.SUCCEEDED)


def test_asking_about_a_track_that_is_not_eligible_says_why(
    enrichers_client: TestClient, enriching: Enriching
) -> None:
    set_up_as_alice(enrichers_client)
    track_id = enriching.add_file_track("Night Drive.m4a")

    response = enrichers_client.post(f"/api/enrichers/{NAME}/tracks/{track_id}")

    assert (response.status_code, response.json()) == (
        409,
        {"detail": "This Track has no video to look up."},
    )


def test_asking_about_a_track_that_does_not_exist_is_not_found(
    enrichers_client: TestClient,
) -> None:
    set_up_as_alice(enrichers_client)

    assert enrichers_client.post(f"/api/enrichers/{NAME}/tracks/99").status_code == 404


def test_a_member_may_ask_about_a_track(enrichers_client: TestClient, enriching: Enriching) -> None:
    set_up_as_alice(enrichers_client)
    add_bob(enrichers_client)
    sign_in(enrichers_client, "bob")
    track_id = enriching.add_site_track(RECORDED)

    response = enrichers_client.post(f"/api/enrichers/{NAME}/tracks/{track_id}")

    assert response.status_code == 200
    enriching.wait_for(JobId(response.json()["id"]), JobState.SUCCEEDED)


def test_an_admin_queues_every_eligible_track_and_is_told_how_many(
    enrichers_client: TestClient, enriching: Enriching
) -> None:
    set_up_as_alice(enrichers_client)
    enriching.add_site_track(RECORDED)
    enriching.add_site_track("BVNoCover")
    enriching.add_file_track("Night Drive.m4a")

    response = enrichers_client.post(f"/api/enrichers/{NAME}/find-all")

    assert (response.status_code, response.json()) == (200, {"queued": 2})
    enriching.finish_every_job()


def test_a_member_cannot_queue_every_track_or_reset(
    enrichers_client: TestClient, enriching: Enriching
) -> None:
    set_up_as_alice(enrichers_client)
    add_bob(enrichers_client)
    sign_in(enrichers_client, "bob")
    enriching.add_site_track(RECORDED)

    queue = enrichers_client.post(f"/api/enrichers/{NAME}/find-all")
    reset = enrichers_client.post(f"/api/enrichers/{NAME}/reset")

    assert (queue.status_code, reset.status_code) == (403, 403)
    assert enriching.jobs.list_jobs() == []


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", f"/api/enrichers/{NAME}"),
        ("POST", f"/api/enrichers/{NAME}/tracks/1"),
        ("POST", f"/api/enrichers/{NAME}/find-all"),
        ("POST", f"/api/enrichers/{NAME}/reset"),
    ],
)
def test_nothing_is_answered_to_a_client_that_is_not_signed_in(
    client: TestClient, method: str, path: str
) -> None:
    assert client.request(method, path).status_code == 401


def test_after_a_refusal_the_enricher_shows_why_it_stopped_and_an_admin_resets_it(
    enrichers_client: TestClient, enriching: Enriching
) -> None:
    set_up_as_alice(enrichers_client)
    refused = enriching.add_site_track("BVRefused")
    enriching.add_site_track(RECORDED)
    job = enrichers_client.post(f"/api/enrichers/{NAME}/tracks/{refused}").json()
    enriching.wait_for(JobId(job["id"]), JobState.FAILED)

    stopped = enrichers_client.get(f"/api/enrichers/{NAME}").json()
    reset = enrichers_client.post(f"/api/enrichers/{NAME}/reset")
    after = enrichers_client.get(f"/api/enrichers/{NAME}").json()

    assert (stopped["stopped"]["reason"], stopped["eligible"]) == ("HTTP Error 412.", [])
    assert reset.status_code == 204
    assert after["stopped"] is None
    assert len(after["eligible"]) == 2


# MusicBrainz, through the same routes

MUSICBRAINZ = "musicbrainz"


def test_musicbrainz_shows_the_tracks_whose_words_it_may_search_for(
    enrichers_client: TestClient, enriching: Enriching
) -> None:
    set_up_as_alice(enrichers_client)
    song = enriching.add_song("Let Down")
    enriching.add_file_track("Night Drive.m4a")

    body = enrichers_client.get(f"/api/enrichers/{MUSICBRAINZ}").json()

    assert body == {"name": MUSICBRAINZ, "available": True, "stopped": None, "eligible": [song]}


def test_asking_musicbrainz_about_a_song_queues_a_job_for_it(
    enrichers_client: TestClient, enriching: Enriching
) -> None:
    set_up_as_alice(enrichers_client)
    track_id = enriching.add_song("Let Down")

    response = enrichers_client.post(f"/api/enrichers/{MUSICBRAINZ}/tracks/{track_id}")

    assert (response.status_code, response.json()["target"]) == (200, f"track:{track_id}")
    enriching.wait_for(JobId(response.json()["id"]), JobState.SUCCEEDED)


def test_asking_musicbrainz_about_a_track_with_nothing_to_search_for_says_why(
    enrichers_client: TestClient, enriching: Enriching
) -> None:
    set_up_as_alice(enrichers_client)
    track_id = enriching.add_file_track("Night Drive.m4a")

    response = enrichers_client.post(f"/api/enrichers/{MUSICBRAINZ}/tracks/{track_id}")

    assert (response.status_code, response.json()) == (
        409,
        {"detail": "This Track shows no title and artist, or album, to search for."},
    )


def test_an_admin_queues_every_song_musicbrainz_may_be_asked_about(
    enrichers_client: TestClient, enriching: Enriching
) -> None:
    set_up_as_alice(enrichers_client)
    enriching.add_song("Let Down")
    enriching.add_song("Karma Police")
    enriching.add_file_track("Night Drive.m4a")

    response = enrichers_client.post(f"/api/enrichers/{MUSICBRAINZ}/find-all")

    assert (response.status_code, response.json()) == (200, {"queued": 2})
    enriching.finish_every_job()


def test_after_musicbrainz_refuses_it_shows_why_it_stopped_and_an_admin_resets_it(
    enrichers_client: TestClient, enriching: Enriching
) -> None:
    set_up_as_alice(enrichers_client)
    refused = enriching.add_song("Refused")
    job = enrichers_client.post(f"/api/enrichers/{MUSICBRAINZ}/tracks/{refused}").json()
    enriching.wait_for(JobId(job["id"]), JobState.FAILED)

    stopped = enrichers_client.get(f"/api/enrichers/{MUSICBRAINZ}").json()
    reset = enrichers_client.post(f"/api/enrichers/{MUSICBRAINZ}/reset")
    after = enrichers_client.get(f"/api/enrichers/{MUSICBRAINZ}").json()

    assert (stopped["stopped"]["reason"], stopped["eligible"]) == ("HTTP Error 403.", [])
    assert reset.status_code == 204
    assert (after["stopped"], after["eligible"]) == (None, [refused])
