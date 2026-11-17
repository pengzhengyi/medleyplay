"""The lyrics API: what a song shows, line by line, and the household's own."""

from fastapi.testclient import TestClient

from medleyplay.application.catalog import CatalogService
from medleyplay.domain.catalog import TrackId
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
    assert {key: shown[key] for key in ("origin", "synced", "instrumental", "plain")} == {
        "origin": "household",
        "synced": True,
        "instrumental": False,
        "plain": "",
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
