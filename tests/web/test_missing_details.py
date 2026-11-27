"""Clean up offers missing details without overwriting existing credits."""

from collections.abc import Iterator
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.catalog import CatalogService
from medleyplay.application.details import record, record_suggested_songs
from medleyplay.application.missing_details import MissingDetailsService
from medleyplay.domain.catalog import TrackDetails, TrackId
from medleyplay.domain.details import Field, Origin
from medleyplay.domain.jobs import JobId, JobState
from medleyplay.domain.video_text import Song
from medleyplay.web.app import create_app
from medleyplay.web.deps import Services
from tests.conftest import TEST_HOST
from tests.support.api import add_bob, set_up_as_alice, sign_in
from tests.support.enrichment import Enriching, running_enrichment
from tests.support.factories import SourceKeyFactory
from tests.support.fakes import FakeClock

MISSING = "/api/missing-details"


@pytest.fixture
def ai_cleanup(
    units: sessionmaker[Session],
    clock: FakeClock,
    tmp_path: Path,
    services: Services,
) -> Iterator[tuple[TestClient, Enriching]]:
    with running_enrichment(units, clock, tmp_path / "data") as running:
        missing = MissingDetailsService(units, clock, running.jobs, running.plugins)
        on = replace(services, jobs=running.jobs, ai=running.ai, missing_details=missing)
        app = create_app(on, allowed_hosts=[TEST_HOST])
        with TestClient(app, base_url=f"http://{TEST_HOST}") as client:
            set_up_as_alice(client)
            provider = client.post(
                "/api/ai/providers",
                json={"base_url": "http://127.0.0.1:11434", "model": "synthetic"},
            )
            assert provider.status_code == 201
            yield client, running


def _ai_on(client: TestClient, *, enabled: bool = True) -> None:
    settings = client.get("/api/settings").json()
    settings["suggest_missing_details_by_ai"] = enabled
    assert client.put("/api/settings", json=settings).status_code == 200


def _item(client: TestClient, track: TrackId) -> dict[str, object]:
    rows: list[dict[str, object]] = client.get(MISSING).json()["tracks"]
    return next(row for row in rows if row["track_id"] == track)


def test_a_same_performer_recording_suggests_an_album_only_until_its_donor_changes(
    client: TestClient, catalog: CatalogService
) -> None:
    set_up_as_alice(client)
    song = catalog.add_track(SourceKeyFactory.bilibili(part=1), TrackDetails("Intro", "Trio"))
    donor = catalog.add_track(
        SourceKeyFactory.bilibili(part=2), TrackDetails("Intro", "Trio", album="Sessions")
    )
    catalog.add_track(
        SourceKeyFactory.bilibili(part=3), TrackDetails("Intro", "Solo", album="Other")
    )

    (row,) = client.get(MISSING).json()["tracks"]

    assert row["track_id"] == song
    assert row["fields"][0]["candidates"] == [{"value": "Sessions", "origin": "library"}]
    client.put(f"/api/tracks/{donor}/details", json={"values": {"album": "Live"}})
    response = client.post(
        f"{MISSING}/{song}/decision",
        json={"key": row["key"], "field": "album", "origin": "library", "value": "Sessions"},
    )
    assert response.status_code == 409
    assert client.get(f"/api/tracks/{song}").json()["album"] == ""


def test_an_intentionally_blank_album_stays_out_of_cleanup_until_its_override_is_removed(
    client: TestClient, catalog: CatalogService
) -> None:
    set_up_as_alice(client)
    song = catalog.add_track(SourceKeyFactory.bilibili(), TrackDetails("Single", "Trio"))
    (row,) = client.get(MISSING).json()["tracks"]

    left = client.post(f"{MISSING}/{song}/decision", json={"key": row["key"], "field": "album"})

    assert left.status_code == 204
    assert client.get(MISSING).json()["tracks"] == []
    removed = client.post(
        "/api/tracks/details", json={"track_ids": [song], "values": {"album": None}}
    )
    assert removed.status_code == 200
    (again,) = client.get(MISSING).json()["tracks"]
    assert again["track_id"] == song
    assert again["fields"] == [{"field": "album", "candidates": []}]


def test_editing_a_single_excludes_only_its_album_until_the_blank_override_is_removed(
    client: TestClient, catalog: CatalogService
) -> None:
    set_up_as_alice(client)
    single = catalog.add_track(SourceKeyFactory.bilibili(part=1), TrackDetails("Single"))
    unknown = catalog.add_track(SourceKeyFactory.bilibili(part=2), TrackDetails("Unknown", "Trio"))
    before = _item(client, single)
    assert before["fields"] == [
        {"field": "album", "candidates": []},
        {"field": "artist", "candidates": []},
    ]

    saved = client.post(
        "/api/tracks/details", json={"track_ids": [single], "values": {"album": ""}}
    )

    assert saved.status_code == 200
    details = client.get(f"/api/tracks/{single}/details").json()
    assert details["origins"]["household"] == {"album": ""}
    assert _item(client, single)["fields"] == [{"field": "artist", "candidates": []}]
    assert _item(client, unknown)["fields"] == [{"field": "album", "candidates": []}]
    removed = client.post(
        "/api/tracks/details", json={"track_ids": [single], "values": {"album": None}}
    )
    assert removed.status_code == 200
    assert _item(client, single)["fields"] == before["fields"]


def test_a_single_choice_invalidates_an_earlier_ai_album_request(
    ai_cleanup: tuple[TestClient, Enriching],
) -> None:
    client, running = ai_cleanup
    track = running.add_song("Single", artist="")
    _ai_on(client)
    running.online.online = False
    before = _item(client, track)
    asked = client.post(f"{MISSING}/{track}/ask", json={"key": before["key"]})
    assert asked.status_code == 202

    saved = client.post("/api/tracks/details", json={"track_ids": [track], "values": {"album": ""}})

    assert saved.status_code == 200
    refused = client.post(f"{MISSING}/{track}/ask", json={"key": before["key"]})
    assert refused.status_code == 409
    running.online.online = True
    running.runner.wake()
    running.wait_for(JobId(asked.json()["id"]), JobState.FAILED)
    assert _item(client, track)["fields"] == [{"field": "artist", "candidates": []}]
    assert _item(client, track)["ai"] == "ready"
    stale = client.post(
        f"{MISSING}/{track}/decision",
        json={
            "key": before["key"],
            "field": "album",
            "value": "Synthetic Album",
            "origin": "ai",
        },
    )
    assert stale.status_code == 409
    details = client.get(f"/api/tracks/{track}/details").json()
    assert details["origins"]["household"] == {"album": ""}


def test_another_listeners_edit_wins_over_a_stale_missing_album_candidate(
    client: TestClient, catalog: CatalogService
) -> None:
    set_up_as_alice(client)
    song = catalog.add_track(SourceKeyFactory.bilibili(part=1), TrackDetails("Intro", "Trio"))
    catalog.add_track(
        SourceKeyFactory.bilibili(part=2), TrackDetails("Intro", "Trio", album="Sessions")
    )
    (row,) = client.get(MISSING).json()["tracks"]
    client.put(f"/api/tracks/{song}/details", json={"values": {"album": "Live"}})

    accepted = client.post(
        f"{MISSING}/{song}/decision",
        json={"key": row["key"], "field": "album", "origin": "library", "value": "Sessions"},
    )

    assert accepted.status_code == 409
    assert client.get(f"/api/tracks/{song}").json()["album"] == "Live"


def test_same_title_does_not_match_uncredited_songs_or_different_bound_namesakes(
    client: TestClient, catalog: CatalogService
) -> None:
    set_up_as_alice(client)
    uncredited = catalog.add_track(SourceKeyFactory.bilibili(part=1), TrackDetails("Intro"))
    catalog.add_track(SourceKeyFactory.bilibili(part=2), TrackDetails("Intro", album="Unknown Set"))
    song = catalog.add_track(SourceKeyFactory.bilibili(part=3), TrackDetails("Closing", "Jay"))
    donor = catalog.add_track(
        SourceKeyFactory.bilibili(part=4), TrackDetails("Closing", "Jay", album="Namesake Set")
    )
    chosen = client.put(f"/api/tracks/{donor}/namesake", json={"name": "Jay", "artist_id": None})
    assert chosen.status_code == 200

    rows = {row["track_id"]: row for row in client.get(MISSING).json()["tracks"]}

    for track_id in (uncredited, song):
        album = next(field for field in rows[track_id]["fields"] if field["field"] == "album")
        assert album["candidates"] == []


def test_naming_a_whole_album_uses_the_library_title_and_keeps_its_existing_artist(
    client: TestClient, catalog: CatalogService
) -> None:
    set_up_as_alice(client)
    album = catalog.add_track(
        SourceKeyFactory.bilibili(), TrackDetails("Live at Home", "Trio", duration_ms=1_800_000)
    )
    (row,) = client.get(MISSING).json()["tracks"]
    assert row["kind"] == "album"
    assert row["fields"] == [
        {"field": "album", "candidates": [{"value": "Live at Home", "origin": "library"}]}
    ]

    saved = client.post(
        f"{MISSING}/{album}/decision",
        json={"key": row["key"], "field": "album", "value": "Live at Home", "origin": "library"},
    )

    assert saved.status_code == 204
    track = client.get(f"/api/tracks/{album}").json()
    assert (track["album"], track["artist"]) == ("Live at Home", "Trio")


def test_accepting_an_album_that_would_hide_a_known_year_returns_its_impact_without_saving(
    client: TestClient, catalog: CatalogService, units: sessionmaker[Session], clock: FakeClock
) -> None:
    set_up_as_alice(client)
    album = catalog.add_track(
        SourceKeyFactory.bilibili(), TrackDetails("Live at Home", "Trio", duration_ms=1_800_000)
    )
    with units.begin() as db:
        record(db, album, Origin.FILES, {Field.YEAR: 2005}, clock())
    row = _item(client, album)

    saved = client.post(
        f"{MISSING}/{album}/decision",
        json={"key": row["key"], "field": "album", "value": "Live at Home", "origin": "library"},
    )

    assert saved.status_code == 409
    assert "Edit details" in saved.json()["detail"]
    assert saved.json()["code"] == "missing_detail_review_required"
    assert saved.json()["impact"] == {
        "details": [{"field": "year", "before": 2005, "after": ""}],
        "split_songs": 0,
        "affected_songs": 0,
        "song_fields": [],
    }
    details = client.get(f"/api/tracks/{album}").json()
    assert (details["album"], details["year"]) == ("", 2005)


def test_album_review_counts_only_split_songs_whose_shown_values_would_change(
    client: TestClient, catalog: CatalogService
) -> None:
    set_up_as_alice(client)
    album = catalog.add_track(
        SourceKeyFactory.bilibili(),
        TrackDetails("Live at Home", "Trio", year=2005, duration_ms=1_800_000),
    )
    split = client.put(
        f"/api/tracks/{album}/songs",
        json={
            "rows": [
                {"title": "Opening", "start_ms": 0, "artist": ""},
                {"title": "Finale", "start_ms": 1000, "artist": ""},
            ]
        },
    )
    assert split.status_code == 200, split.text
    first, second = (song["track_id"] for song in split.json()["songs"])
    assert client.put(f"/api/tracks/{second}/details", json={"values": {"year": 2006}}).is_success
    row = _item(client, album)

    refused = client.post(
        f"{MISSING}/{album}/decision",
        json={"key": row["key"], "field": "album", "value": "Live at Home", "origin": "library"},
    )

    assert refused.status_code == 409, refused.text
    assert refused.json()["impact"] == {
        "details": [{"field": "year", "before": 2005, "after": ""}],
        "split_songs": 2,
        "affected_songs": 1,
        "song_fields": ["year"],
    }
    assert client.get(f"/api/tracks/{album}").json()["album"] == ""
    assert client.get(f"/api/tracks/{first}").json()["year"] == 2005
    assert client.get(f"/api/tracks/{second}").json()["year"] == 2006


def test_ai_is_opt_in_and_does_not_replace_the_existing_split_suggestions(
    ai_cleanup: tuple[TestClient, Enriching],
) -> None:
    client, running = ai_cleanup
    track = running.add_song("Concert", artist="", duration_ms=1_800_000)
    with running.units.begin() as db:
        record_suggested_songs(db, track, [Song(0, "Opening")], running.clock())
    split_before = client.get(f"/api/tracks/{track}/songs").json()
    row = _item(client, track)
    assert row["ai"] == "off"
    assert client.post(f"{MISSING}/{track}/ask", json={"key": row["key"]}).status_code == 409
    _ai_on(client)
    assert _item(client, track)["ai"] == "ready"
    assert running.jobs.list_jobs() == []

    asked = client.post(f"{MISSING}/{track}/ask", json={"key": row["key"]})
    assert asked.status_code == 202
    running.wait_for(JobId(asked.json()["id"]), JobState.SUCCEEDED)

    candidate = {"field": "album_artist", "value": "Synthetic Artist", "origin": "ai"}
    assert _item(client, track)["ai"] == "answered"
    assert client.get(f"/api/tracks/{track}/songs").json() == split_before
    assert client.get(f"/api/tracks/{track}").json()["album_artist"] == ""
    _ai_on(client, enabled=False)
    assert _item(client, track)["ai"] == "off"
    refused = client.post(f"{MISSING}/{track}/decision", json={"key": row["key"], **candidate})
    assert refused.status_code == 409
    assert client.get(f"/api/tracks/{track}").json()["album_artist"] == ""


def test_an_album_artist_can_be_accepted_without_saving_any_other_ai_values(
    ai_cleanup: tuple[TestClient, Enriching],
) -> None:
    client, running = ai_cleanup
    track = running.add_song("Concert", artist="", duration_ms=1_800_000)
    _ai_on(client)
    row = _item(client, track)
    asked = client.post(f"{MISSING}/{track}/ask", json={"key": row["key"]})
    running.wait_for(JobId(asked.json()["id"]), JobState.SUCCEEDED)

    saved = client.post(
        f"{MISSING}/{track}/decision",
        json={
            "key": row["key"],
            "field": "album_artist",
            "value": "Synthetic Artist",
            "origin": "ai",
        },
    )

    assert saved.status_code == 204
    details = client.get(f"/api/tracks/{track}/details").json()
    assert details["origins"]["household"] == {"album_artist": "Synthetic Artist"}
    assert "ai" not in details["origins"]


def test_filename_and_inherited_details_alone_never_queue_an_ai_request(
    ai_cleanup: tuple[TestClient, Enriching],
) -> None:
    client, running = ai_cleanup
    parent = running.add_song("Private recording filename", artist="", origin=Origin.FILE_NAME)
    _ai_on(client)
    # A saved split row contributes its fields through the album-file origin.
    split = client.put(
        f"/api/tracks/{parent}/songs",
        json={
            "rows": [
                {"title": "Unnamed excerpt", "start_ms": 0, "artist": ""},
                {"title": "Another excerpt", "start_ms": 1000, "artist": ""},
            ]
        },
    )
    assert split.status_code == 200, split.text
    child = TrackId(split.json()["songs"][0]["track_id"])
    row = _item(client, child)

    refused = client.post(f"{MISSING}/{child}/ask", json={"key": row["key"]})

    assert row["ai"] == "no_metadata"
    assert refused.status_code == 409
    assert running.jobs.list_jobs() == []


def test_two_listeners_share_a_job_only_for_the_same_track_revision(
    ai_cleanup: tuple[TestClient, Enriching],
) -> None:
    client, running = ai_cleanup
    track = running.add_song("Intro")
    _ai_on(client)
    running.online.online = False
    before = _item(client, track)
    first = client.post(f"{MISSING}/{track}/ask", json={"key": before["key"]})
    assert first.status_code == 202
    add_bob(client)
    sign_in(client, "bob")
    again = client.post(f"{MISSING}/{track}/ask", json={"key": before["key"]})
    assert again.json()["id"] == first.json()["id"]
    client.put(f"/api/tracks/{track}/details", json={"values": {"title": "Outro"}})
    after = _item(client, track)

    conflicting = client.post(f"{MISSING}/{track}/ask", json={"key": after["key"]})

    assert conflicting.status_code == 409
    running.online.online = True
    running.runner.wake()
    running.wait_for(JobId(first.json()["id"]), JobState.FAILED)
    assert _item(client, track)["ai"] == "ready"
    assert _item(client, track)["fields"] == [{"field": "album", "candidates": []}]
