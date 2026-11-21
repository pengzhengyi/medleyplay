"""The album covers API: what MusicBrainz found for an album, and an AI model's pick."""

from datetime import UTC, datetime

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.album_covers import album_key
from medleyplay.persistence.schema import AlbumCoverSearchRow
from tests.support.api import set_up_as_alice

VINYL = "0a1b2c3d-0000-4000-8000-000000001965"
CD = "0a1b2c3d-0000-4000-8000-000000001987"
HELP = {"album": "Help!", "artist": "The Beatles"}


def _help_found(units: sessionmaker[Session], *, offered: list[str], pick: str | None) -> None:
    """Keep *Help!*'s 1965 vinyl and 1987 CD as found, and a model's pick among `offered`."""
    with units.begin() as db:
        db.add(
            AlbumCoverSearchRow(
                key=album_key("Help!", "The Beatles"),
                album="Help!",
                artist="The Beatles",
                covers=[
                    {
                        "option": {"release_id": VINYL, "title": "Help!", "date": "1965"},
                        "cover": "a1",
                    },
                    {"option": {"release_id": CD, "title": "Help!", "date": "1987"}, "cover": "b2"},
                ],
                found_at=datetime(2026, 11, 2, tzinfo=UTC),
                offered=offered,
                pick=pick,
                why="The CD, by its songs" if pick else "",
                model="deepseek-flash",
                host="api.deepseek.com",
                chosen_at=datetime(2026, 11, 3, tzinfo=UTC),
            )
        )


def test_nothing_is_known_of_an_albums_covers_until_asked(client: TestClient) -> None:
    set_up_as_alice(client)

    response = client.get("/api/album-covers", params=HELP)

    assert response.json() == {
        "covers": [],
        "found_at": None,
        "pick": None,
        "finding": False,
        "choosing": False,
        "waiting": False,
        "failure": None,
        "choice_failure": None,
        "may_choose": False,
        "suggested": None,
        "due": True,
    }


def test_the_covers_found_are_listed_best_first_with_the_models_pick(
    client: TestClient, units: sessionmaker[Session]
) -> None:
    set_up_as_alice(client)
    _help_found(units, offered=[VINYL, CD], pick=CD)

    known = client.get("/api/album-covers", params=HELP).json()

    assert [(each["release"]["release_id"], each["cover"]) for each in known["covers"]] == [
        (VINYL, "a1"),
        (CD, "b2"),
    ]
    assert known["pick"] == {
        "release_id": CD,
        "why": "The CD, by its songs",
        "model": "deepseek-flash",
        "host": "api.deepseek.com",
        "at": "2026-11-03T00:00:00Z",
    }
    assert (known["suggested"], known["due"]) == ("b2", False)


def test_a_pick_among_releases_other_than_those_found_is_not_shown(
    client: TestClient, units: sessionmaker[Session]
) -> None:
    set_up_as_alice(client)
    _help_found(units, offered=[CD], pick=CD)

    known = client.get("/api/album-covers", params=HELP).json()

    assert known["pick"] is None


def test_a_dismissed_cover_is_suggested_no_more(
    client: TestClient, units: sessionmaker[Session]
) -> None:
    set_up_as_alice(client)
    _help_found(units, offered=[VINYL, CD], pick=CD)

    response = client.post("/api/album-covers/dismiss", json={**HELP, "cover": "b2"})

    assert response.status_code == 204
    assert client.get("/api/album-covers", params=HELP).json()["suggested"] is None


def test_only_a_cover_found_for_the_album_may_be_dismissed(
    client: TestClient, units: sessionmaker[Session]
) -> None:
    set_up_as_alice(client)
    _help_found(units, offered=[VINYL, CD], pick=CD)

    response = client.post("/api/album-covers/dismiss", json={**HELP, "cover": "c3"})

    assert response.status_code == 422


def test_no_covers_are_found_while_the_musicbrainz_plugin_is_off(client: TestClient) -> None:
    set_up_as_alice(client)

    response = client.post("/api/album-covers/find", json=HELP)

    assert response.status_code == 409
    assert "MusicBrainz" in response.json()["detail"]


def test_an_album_is_named_to_find_its_covers(client: TestClient) -> None:
    set_up_as_alice(client)

    assert client.get("/api/album-covers", params={"artist": "The Beatles"}).status_code == 422
    assert client.post("/api/album-covers/find", json={"album": ""}).status_code == 422


def test_album_covers_are_for_signed_in_accounts(client: TestClient) -> None:
    assert client.get("/api/album-covers", params=HELP).status_code == 401
    assert client.post("/api/album-covers/find", json=HELP).status_code == 401
    assert client.post("/api/album-covers/choose", json=HELP).status_code == 401
    dismissed = {**HELP, "cover": "b2"}
    assert client.post("/api/album-covers/dismiss", json=dismissed).status_code == 401
