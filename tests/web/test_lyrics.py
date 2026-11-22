"""The lyrics API: what a song shows, line by line, and the household's own."""

from datetime import UTC, datetime

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.catalog import CatalogService
from medleyplay.domain.catalog import TrackId
from medleyplay.persistence.schema import LyricsSearchRow
from tests.support.api import set_up_as_alice
from tests.support.factories import SourceKeyFactory, TrackDetailsFactory

MELT = """\
[00:12.34]朝目が覚めて
[00:12.34]Waking up in the morning
[00:15.50]<00:15.50>真っ先に<00:16.20>思い浮かぶ
"""


def _song(catalog: CatalogService) -> TrackId:
    return catalog.add_track(SourceKeyFactory.bilibili(), TrackDetailsFactory.song())


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


def test_no_model_is_asked_while_the_ai_plugin_is_off(
    client: TestClient, catalog: CatalogService
) -> None:
    set_up_as_alice(client)
    song = _song(catalog)

    response = client.post(f"/api/tracks/{song}/lyrics/choose")

    assert response.status_code == 409
    assert "ai-details" in response.json()["detail"]
