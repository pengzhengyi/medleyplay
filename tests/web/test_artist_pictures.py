"""The artist pictures API: the pictures Deezer has of an artist, to choose its photo from."""

from datetime import UTC, datetime

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.persistence.schema import ArtistPictureSearchRow, ArtistRow
from tests.support.api import set_up_as_alice


def _beatles_known(units: sessionmaker[Session]) -> None:
    """Keep The Beatles as an artist MusicBrainz named, as looking a name up would."""
    with units.begin() as db:
        db.add(
            ArtistRow(
                id="b10bbbfc",
                name="The Beatles",
                sort_name="Beatles, The",
                disambiguation="",
                country="GB",
                found_at=datetime(2026, 11, 1, tzinfo=UTC),
            )
        )


def _deezer_turned_on(client: TestClient) -> None:
    client.put(
        "/api/settings", json={"storage_limit": None, "picture_sites": ["deezer"], "revision": 0}
    )


def test_nothing_is_known_of_an_artists_pictures_until_asked(
    client: TestClient, units: sessionmaker[Session]
) -> None:
    set_up_as_alice(client)
    _beatles_known(units)

    response = client.get("/api/artists/b10bbbfc/pictures")

    assert response.json() == {
        "pictures": [],
        "found_at": None,
        "finding": False,
        "waiting": False,
        "failure": None,
        "may_find": False,
        "pick": None,
        "choosing": False,
        "choice_failure": None,
        "may_choose": False,
    }


def test_the_pictures_found_are_listed_most_followed_first(
    client: TestClient, units: sessionmaker[Session]
) -> None:
    set_up_as_alice(client)
    _beatles_known(units)
    _deezer_turned_on(client)
    with units.begin() as db:
        db.add(
            ArtistPictureSearchRow(
                artist_id="b10bbbfc",
                site="deezer",
                pictures=[
                    {"name": "The Beatles", "fans": 4_100_000, "cover": "a1"},
                    {"name": "The Beatles Tribute", "fans": None, "cover": "b2"},
                ],
                found_at=datetime(2026, 11, 2, tzinfo=UTC),
            )
        )

    known = client.get("/api/artists/b10bbbfc/pictures").json()

    assert known["pictures"] == [
        {"name": "The Beatles", "fans": 4_100_000, "cover": "a1"},
        {"name": "The Beatles Tribute", "fans": None, "cover": "b2"},
    ]
    assert (known["found_at"], known["may_find"]) == ("2026-11-02T00:00:00Z", True)


def test_the_picture_an_ai_model_picked_is_listed_with_why_and_the_note(
    client: TestClient, units: sessionmaker[Session]
) -> None:
    set_up_as_alice(client)
    _beatles_known(units)
    with units.begin() as db:
        db.add(
            ArtistPictureSearchRow(
                artist_id="b10bbbfc",
                site="deezer",
                pictures=[
                    {"name": "The Beatles", "fans": 4_100_000, "cover": "a1"},
                    {"name": "The Beatles", "fans": 120, "cover": "b2"},
                ],
                found_at=datetime(2026, 11, 2, tzinfo=UTC),
                offered=["a1", "b2"],
                pick="b2",
                why="A tribute, by its following",
                hint="the tribute act",
                model="deepseek-flash",
                host="api.deepseek.com",
                chosen_at=datetime(2026, 11, 3, tzinfo=UTC),
            )
        )

    known = client.get("/api/artists/b10bbbfc/pictures").json()

    assert known["pick"] == {
        "cover": "b2",
        "why": "A tribute, by its following",
        "model": "deepseek-flash",
        "host": "api.deepseek.com",
        "at": "2026-11-03T00:00:00Z",
        "hint": "the tribute act",
    }


def test_asking_which_picture_fits_needs_the_ai_details_plugin(
    client: TestClient, units: sessionmaker[Session]
) -> None:
    set_up_as_alice(client)
    _beatles_known(units)

    response = client.post("/api/artists/b10bbbfc/pictures/choose", json={"hint": "the band"})

    assert response.status_code == 409
    assert "ai-details plugin" in response.json()["detail"]


def test_a_note_to_the_ai_past_its_length_is_refused(
    client: TestClient, units: sessionmaker[Session]
) -> None:
    set_up_as_alice(client)
    _beatles_known(units)

    response = client.post("/api/artists/b10bbbfc/pictures/choose", json={"hint": "x" * 501})

    assert response.status_code == 422


def test_deezer_is_never_asked_until_turned_on_in_settings(
    client: TestClient, units: sessionmaker[Session]
) -> None:
    set_up_as_alice(client)
    _beatles_known(units)

    response = client.post("/api/artists/b10bbbfc/pictures/find")

    assert response.status_code == 409
    assert "Turn on Deezer in Settings" in response.json()["detail"]


def test_deezer_is_never_asked_while_its_plugin_is_off(
    client: TestClient, units: sessionmaker[Session]
) -> None:
    set_up_as_alice(client)
    _beatles_known(units)
    _deezer_turned_on(client)

    response = client.post("/api/artists/b10bbbfc/pictures/find")

    assert response.status_code == 409
    assert "deezer plugin" in response.json()["detail"]


def test_an_artist_no_site_named_has_no_pictures(client: TestClient) -> None:
    set_up_as_alice(client)

    assert client.get("/api/artists/nobody/pictures").status_code == 404
    assert client.post("/api/artists/nobody/pictures/find").status_code == 404


def test_artist_pictures_are_for_signed_in_accounts(client: TestClient) -> None:
    assert client.get("/api/artists/b10bbbfc/pictures").status_code == 401
    assert client.post("/api/artists/b10bbbfc/pictures/find").status_code == 401
    assert client.post("/api/artists/b10bbbfc/pictures/choose", json={}).status_code == 401
