"""The lyrics API: what a song shows, line by line, and the household's own."""

from collections.abc import Iterator
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.catalog import CatalogService
from medleyplay.domain.catalog import TrackId
from medleyplay.persistence.schema import LyricsSearchRow
from medleyplay.web.app import create_app
from medleyplay.web.deps import Services
from tests.conftest import TEST_HOST
from tests.support.ai import OLLAMA
from tests.support.api import set_up_as_alice
from tests.support.enrichment import Enriching, running_enrichment
from tests.support.factories import SourceKeyFactory, TrackDetailsFactory
from tests.support.fakes import FakeClock
from tests.support.plugins.reader import LANTERN_WALTZ, LANTERN_WALTZ_TRANSLATION, lyrics_of

MELT = """\
[00:12.34]朝目が覚めて
[00:12.34]Waking up in the morning
[00:15.50]<00:15.50>真っ先に<00:16.20>思い浮かぶ
"""


def _song(catalog: CatalogService) -> TrackId:
    return catalog.add_track(SourceKeyFactory.bilibili(), TrackDetailsFactory.song())


@pytest.fixture
def matching(
    units: sessionmaker[Session], clock: FakeClock, tmp_path: Path, services: Services
) -> Iterator[tuple[TestClient, Enriching]]:
    """Serve real match Jobs with a finder and chooser that answer without a network."""
    with running_enrichment(units, clock, tmp_path / "data") as running:
        app = create_app(
            replace(
                services,
                plugins=running.plugins,
                jobs=running.jobs,
                ai=running.ai,
                lyrics=running.lyrics,
                lyrics_search=running.lyrics_search,
                lyrics_match=running.lyrics_match,
            ),
            allowed_hosts=[TEST_HOST],
            client_dir=tmp_path / "client",
        )
        with TestClient(app, base_url=f"http://{TEST_HOST}") as client:
            yield client, running


def test_one_batch_finds_and_chooses_then_another_page_saves_every_ready_song(
    matching: tuple[TestClient, Enriching],
) -> None:
    client, running = matching
    set_up_as_alice(client)
    provider = client.post("/api/ai/providers", json={"base_url": OLLAMA, "model": "synthetic"})
    assert provider.status_code == 201, provider.text
    album = running.add_song("Album")
    route = f"/api/tracks/{album}/songs"
    saved = client.put(
        route,
        json={
            "rows": [
                {"start_ms": 0, "title": "Melt", "artist": "ryo"},
                {"start_ms": 100_000, "title": "Encore", "artist": "ryo"},
                {"start_ms": 200_000, "title": "Silence", "artist": "ryo"},
            ]
        },
    )
    assert saved.status_code == 200, saved.text
    songs = saved.json()["songs"]

    started = client.post(
        f"{route}/lyrics-match",
        json=[
            {key: row[key] for key in ("track_id", "start_ms", "title", "artist")}
            | {"segment_id": row["id"]}
            for row in songs
        ],
    )
    assert started.status_code == 202, started.text
    running.finish_every_job()
    running.online.online = False

    with TestClient(client.app, base_url=f"http://{TEST_HOST}") as reopened:
        reopened.cookies.update(client.cookies)
        matches = reopened.get(f"{route}/lyrics-match").json()
        assert [match["state"] for match in matches] == ["ready", "ready", "skipped"]
        assert matches[2]["note"] == "No clear match."
        for song in songs:
            assert reopened.get(f"/api/tracks/{song['track_id']}/lyrics").json() is None
        kept = reopened.put(
            route,
            json={
                "rows": [
                    {key: row[key] for key in ("id", "start_ms", "title", "artist")}
                    for row in songs
                ],
                "known": [row["id"] for row in songs],
                "lyric_picks": [
                    match["choice_job_id"] for match in matches if match["state"] == "ready"
                ],
            },
        )
        assert kept.status_code == 200, kept.text
        assert kept.json()["songs"] == songs
        for song in songs[:2]:
            lyrics = reopened.get(f"/api/tracks/{song['track_id']}/lyrics").json()
            assert lyrics is not None, song["title"]
            assert (lyrics["origin"], lyrics["text"]) == ("lrclib", lyrics_of(song["title"]))
        assert reopened.get(f"/api/tracks/{songs[2]['track_id']}/lyrics").json() is None
    assert [match["state"] for match in client.get(f"{route}/lyrics-match").json()] == [
        "saved",
        "saved",
        "skipped",
    ]


@pytest.mark.parametrize(
    ("title", "language", "state"),
    [
        ("Lantern Waltz", "en", "ready"),
        ("Lantern Waltz", "zh-Hans", "skipped"),
        ("Lantern Waltz (Instrumental Candidate)", "en", "skipped"),
        ("Lantern Waltz (Unclassified Translation)", "en", "skipped"),
    ],
    ids=["available-translation", "wrong-language", "conflicting-version", "unclassified-pair"],
)
def test_auto_match_saves_original_and_paired_translation_when_it_resolves_a_tie(
    matching: tuple[TestClient, Enriching], title: str, language: str, state: str
) -> None:
    client, running = matching
    set_up_as_alice(client)
    assert client.post(
        "/api/ai/providers", json={"base_url": OLLAMA, "model": "synthetic"}
    ).is_success
    assert client.put(
        "/api/settings", json={"storage_limit": None, "lyrics_sites": ["netease"], "revision": 0}
    ).is_success
    album = running.add_song("Instrument Test Album")
    route = f"/api/tracks/{album}/songs"
    rows = [
        {"start_ms": 0, "title": title, "artist": "Test Band"},
        {"start_ms": 180_000, "title": "Closing Track", "artist": "Test Band"},
    ]
    saved = client.put(route, json={"rows": rows})
    assert saved.is_success
    first, last = saved.json()["songs"]
    start = client.post(
        f"{route}/lyrics-match",
        headers={"Accept-Language": language},
        json=[rows[0] | {"segment_id": first["id"], "track_id": first["track_id"]}],
    )

    assert start.is_success
    running.finish_every_job()
    (match,) = client.get(f"{route}/lyrics-match").json()
    assert match["state"] == state
    lyric_route = f"/api/tracks/{first['track_id']}/lyrics"
    assert client.get(lyric_route).json() is None
    if state == "ready":
        kept = client.put(
            route,
            json={
                "rows": [
                    row | {"id": saved_row["id"]}
                    for row, saved_row in zip(rows, (first, last), strict=True)
                ],
                "known": [first["id"], last["id"]],
                "lyric_picks": [match["choice_job_id"]],
            },
        )
        assert kept.is_success, kept.text
        lyrics = client.get(lyric_route).json()
        assert (lyrics["origin"], lyrics["text"]) == (
            "netease",
            LANTERN_WALTZ + LANTERN_WALTZ_TRANSLATION,
        )
        assert (lyrics["lines"][0]["text"], lyrics["lines"][0]["translation"]) == (
            "あおい空",
            "I see the sky",
        )


def test_a_song_with_no_lyrics_shows_none(client: TestClient, catalog: CatalogService) -> None:
    set_up_as_alice(client)
    song = _song(catalog)

    response = client.get(f"/api/tracks/{song}/lyrics")

    assert (response.status_code, response.json()) == (200, None)


def test_the_households_lyrics_are_shown_line_by_line(
    client: TestClient, catalog: CatalogService
) -> None:
    set_up_as_alice(client)
    song = _song(catalog)

    put = client.put(f"/api/tracks/{song}/lyrics", json={"text": MELT})
    shown = client.get(f"/api/tracks/{song}/lyrics").json()

    assert put.status_code == 200
    assert {key: shown[key] for key in ("origin", "synced", "instrumental", "plain", "text")} == {
        "origin": "household",
        "synced": True,
        "instrumental": False,
        "plain": "",
        "text": MELT,
    }
    assert shown["lines"] == [
        {
            "at_ms": 12_340,
            "text": "朝目が覚めて",
            "translation": "Waking up in the morning",
            "words": [],
        },
        {
            "at_ms": 15_500,
            "text": "真っ先に思い浮かぶ",
            "translation": "",
            "words": [
                {"at_ms": 15_500, "text": "真っ先に"},
                {"at_ms": 16_200, "text": "思い浮かぶ"},
            ],
        },
    ]


def test_the_households_lyrics_are_dropped(client: TestClient, catalog: CatalogService) -> None:
    set_up_as_alice(client)
    song = _song(catalog)
    client.put(f"/api/tracks/{song}/lyrics", json={"text": MELT})

    dropped = client.delete(f"/api/tracks/{song}/lyrics")

    assert (dropped.status_code, dropped.json()) == (200, None)


def test_dismissing_a_suggestion_answers_the_lyrics_shown_now(
    client: TestClient, catalog: CatalogService
) -> None:
    set_up_as_alice(client)
    song = _song(catalog)
    client.put(f"/api/tracks/{song}/lyrics", json={"text": MELT})

    dismissed = client.delete(f"/api/tracks/{song}/lyrics/suggestion")

    assert dismissed.status_code == 200
    assert dismissed.json()["origin"] == "household"


def test_dismissing_a_suggestion_needs_a_signed_in_account(
    client: TestClient, catalog: CatalogService
) -> None:
    song = _song(catalog)

    assert client.delete(f"/api/tracks/{song}/lyrics/suggestion").status_code == 401


def test_empty_lyrics_are_refused_unless_the_song_is_instrumental(
    client: TestClient, catalog: CatalogService
) -> None:
    set_up_as_alice(client)
    song = _song(catalog)

    empty = client.put(f"/api/tracks/{song}/lyrics", json={"text": " "})
    instrumental = client.put(f"/api/tracks/{song}/lyrics", json={"instrumental": True})

    assert empty.status_code == 422
    assert instrumental.json()["instrumental"] is True


def test_the_lyrics_of_a_missing_track_are_not_found(client: TestClient) -> None:
    set_up_as_alice(client)

    assert client.get("/api/tracks/999/lyrics").status_code == 404


def test_lyrics_need_a_signed_in_account(client: TestClient, catalog: CatalogService) -> None:
    song = _song(catalog)

    assert client.get(f"/api/tracks/{song}/lyrics").status_code == 401


def test_nothing_is_found_for_a_songs_lyrics_until_looked_for(
    client: TestClient, catalog: CatalogService
) -> None:
    set_up_as_alice(client)
    song = _song(catalog)

    response = client.get(f"/api/tracks/{song}/lyrics/found")

    assert response.json() == {
        "title": "",
        "artist": "",
        "options": [],
        "found_at": None,
        "pick": None,
        "finding": False,
        "choosing": False,
        "waiting": False,
        "failure": None,
        "choice_failure": None,
        "may_choose": False,
    }


def test_the_songs_found_are_listed_with_their_lyrics_what_was_asked_and_the_pick(
    client: TestClient, catalog: CatalogService, units: sessionmaker[Session]
) -> None:
    set_up_as_alice(client)
    song = _song(catalog)
    melt = {"provider": "lrclib", "title": "Melt", "artist": "ryo", "duration_ms": 260_000}
    with units.begin() as db:
        db.add(
            LyricsSearchRow(
                track_id=song,
                title="Melt",
                artist="ryo",
                options=[melt | {"text": MELT}],
                found_at=datetime(2026, 11, 19, tzinfo=UTC),
                offered=["\n".join(str(value) for value in melt.values())],
                pick=0,
                why="The studio recording",
                model="deepseek-flash",
                host="api.deepseek.com",
                chosen_at=datetime(2026, 11, 19, 1, tzinfo=UTC),
            )
        )

    found = client.get(f"/api/tracks/{song}/lyrics/found").json()

    assert (found["title"], found["artist"]) == ("Melt", "ryo")
    assert found["options"] == [
        melt | {"album": "", "text": MELT, "instrumental": False},
    ]
    assert found["pick"] == {
        "option": 0,
        "why": "The studio recording",
        "model": "deepseek-flash",
        "host": "api.deepseek.com",
        "at": "2026-11-19T01:00:00Z",
    }


def test_no_lyrics_are_found_while_the_lyrics_plugin_is_off(
    client: TestClient, catalog: CatalogService
) -> None:
    set_up_as_alice(client)
    song = _song(catalog)

    response = client.post(f"/api/tracks/{song}/lyrics/find", json={"title": "Melt"})

    assert response.status_code == 409
    assert "lyrics plugin" in response.json()["detail"]


def test_lyrics_are_found_by_a_title(client: TestClient, catalog: CatalogService) -> None:
    set_up_as_alice(client)
    song = _song(catalog)

    response = client.post(f"/api/tracks/{song}/lyrics/find", json={"title": "", "artist": "ryo"})

    assert response.status_code == 422


def test_finding_lyrics_needs_a_signed_in_account(
    client: TestClient, catalog: CatalogService
) -> None:
    song = _song(catalog)

    assert client.get(f"/api/tracks/{song}/lyrics/found").status_code == 401
    assert client.post(f"/api/tracks/{song}/lyrics/find", json={"title": "Melt"}).status_code == 401
    assert client.post(f"/api/tracks/{song}/lyrics/choose").status_code == 401


def test_album_matching_does_not_queue_work_with_the_lyrics_plugin_off(
    client: TestClient, catalog: CatalogService
) -> None:
    set_up_as_alice(client)
    song = _song(catalog)
    response = client.post(
        f"/api/tracks/{song}/lyrics/match/find",
        json={"segment_id": 1, "start_ms": 0, "title": "Melt", "artist": "ryo"},
    )
    assert response.status_code == 409
    assert "lyrics plugin" in response.json()["detail"]
    assert client.get("/api/jobs").json() == []


def test_background_auto_match_requires_sign_in_and_does_not_queue_with_the_plugin_off(
    client: TestClient, catalog: CatalogService
) -> None:
    album = _song(catalog)
    route = f"/api/tracks/{album}/songs/lyrics-match"
    saved = [{"track_id": 2, "segment_id": 1, "start_ms": 0, "title": "Melt", "artist": "ryo"}]

    assert client.post(route, json=saved).status_code == 401
    assert client.get(route).status_code == 401
    set_up_as_alice(client)
    response = client.post(route, json=saved)

    assert response.status_code == 409
    assert "lyrics plugin" in response.json()["detail"]
    assert client.get(route).json() == []
    assert client.get("/api/jobs").json() == []


def test_the_songs_view_marks_manually_saved_lyrics_selected_without_an_auto_match_job(
    client: TestClient, catalog: CatalogService
) -> None:
    set_up_as_alice(client)
    album = _song(catalog)
    songs = f"/api/tracks/{album}/songs"
    split = client.put(
        songs,
        json={"rows": [{"start_ms": 0, "title": "Intro"}, {"start_ms": 1000, "title": "Outro"}]},
    )
    assert split.status_code == 200, split.text
    song = split.json()["songs"][0]["track_id"]

    assert client.put(f"/api/tracks/{song}/lyrics", json={"text": MELT}).status_code == 200

    (selected,) = client.get(f"{songs}/lyrics-match").json()
    assert (selected["track_id"], selected["state"], selected["job_id"]) == (song, "selected", None)
    assert client.delete(f"/api/tracks/{song}/lyrics").status_code == 200
    assert client.get(f"{songs}/lyrics-match").json() == []


def test_no_model_is_asked_while_the_ai_plugin_is_off(
    client: TestClient, catalog: CatalogService
) -> None:
    set_up_as_alice(client)
    song = _song(catalog)

    response = client.post(f"/api/tracks/{song}/lyrics/choose")

    assert response.status_code == 409
    assert "ai-details" in response.json()["detail"]
