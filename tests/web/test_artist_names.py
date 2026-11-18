"""The artist names API: the Library's artist names, and the links the household chose."""

from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.artists import KnownArtist
from medleyplay.application.catalog import CatalogService
from medleyplay.domain.artists import Alias, Artist
from medleyplay.domain.catalog import SourceKey, TrackDetails, TrackId
from medleyplay.domain.covers import MAX_COVER_BYTES
from medleyplay.persistence.schema import ArtistRow, ArtistSuggestionRow
from medleyplay.web.artists import ArtistOut
from tests.support.api import set_up_as_alice
from tests.support.images import gif_image, png_image


def _song_by(catalog: CatalogService, artist: str, title: str = "Song") -> TrackId:
    """Add a Library file whose tags name `artist`."""
    return catalog.add_track(
        SourceKey("library", f"1/Music/{title}.m4a"), TrackDetails(title, artist)
    )


def test_the_artist_names_in_the_library_are_listed(
    client: TestClient, catalog: CatalogService
) -> None:
    set_up_as_alice(client)
    song = _song_by(catalog, "披头士")
    [artist_id] = client.get(f"/api/tracks/{song}").json()["artist_ids"]

    body = client.get("/api/artist-names").json()

    assert body == {
        "names": [
            {
                "name": "披头士",
                "key": "披头士",
                "tracks": 1,
                "look_up": "yes",
                "linked": False,
                "artist_id": None,
                "looked_at": None,
                "candidates": [],
                "suggested": None,
                "finding": False,
                "recommendation": None,
                "artist_ids": [artist_id],
            }
        ],
        "artists": [],
        "recommending": False,
    }


def test_a_name_is_linked_to_no_artist_and_then_unlinked(
    client: TestClient, catalog: CatalogService
) -> None:
    set_up_as_alice(client)
    _song_by(catalog, "Blue Room")

    linked = client.put("/api/artist-names/link", json={"name": "Blue Room", "artist_id": None})
    after_link = client.get("/api/artist-names").json()["names"][0]
    unlinked = client.post("/api/artist-names/unlink", json={"name": "Blue Room"})

    assert (linked.status_code, unlinked.status_code) == (204, 204)
    assert (after_link["linked"], after_link["artist_id"]) == (True, None)
    assert client.get("/api/artist-names").json()["names"][0]["linked"] is False


def test_a_name_is_not_linked_to_an_artist_never_named(
    client: TestClient, catalog: CatalogService
) -> None:
    set_up_as_alice(client)
    _song_by(catalog, "披头士")

    linked = client.put("/api/artist-names/link", json={"name": "披头士", "artist_id": "b10bbbfc"})

    assert linked.status_code == 404


def test_names_are_not_looked_up_while_musicbrainz_is_off(client: TestClient) -> None:
    set_up_as_alice(client)

    asked = client.post("/api/artist-names/look-up", json={"names": ["披头士"]})

    assert asked.status_code == 409


def test_no_ai_model_is_asked_while_the_ai_plugin_is_off(client: TestClient) -> None:
    set_up_as_alice(client)

    asked = client.post("/api/artist-names/recommend")

    assert asked.status_code == 409


def test_the_names_say_no_ai_model_is_being_asked(
    client: TestClient, catalog: CatalogService
) -> None:
    set_up_as_alice(client)
    _song_by(catalog, "Blue Room")

    listed = client.get("/api/artist-names").json()

    assert listed["recommending"] is False
    assert listed["names"][0]["recommendation"] is None


def test_the_artist_names_are_for_signed_in_accounts(client: TestClient) -> None:
    assert client.get("/api/artist-names").status_code == 401


def test_an_artist_shows_its_names_and_its_page_and_photo_from_wikidata() -> None:
    known = KnownArtist(
        Artist("b10bbbfc", "The Beatles", "Beatles, The", "Liverpool rock band", "GB"),
        (Alias("披头士", "zh"),),
        page="https://www.wikidata.org/wiki/Q1299",
        photo="9f2c" * 16,
        photo_page="https://commons.wikimedia.org/wiki/File:The_Beatles.jpg",
    )

    shown = ArtistOut.of(known).model_dump()

    assert shown == {
        "id": "b10bbbfc",
        "name": "The Beatles",
        "sort_name": "Beatles, The",
        "disambiguation": "Liverpool rock band",
        "country": "GB",
        "aliases": [{"name": "披头士", "locale": "zh", "primary": False}],
        "page": "https://www.wikidata.org/wiki/Q1299",
        "photo": "9f2c" * 16,
        "photo_page": "https://commons.wikimedia.org/wiki/File:The_Beatles.jpg",
        "shown_as": None,
        "about": None,
        "own_photo": False,
    }


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


def test_the_household_shows_an_artist_by_a_name_of_its_choosing_with_a_note(
    client: TestClient, units: sessionmaker[Session]
) -> None:
    set_up_as_alice(client)
    _beatles_known(units)

    saved = client.put(
        "/api/artists/b10bbbfc/details", json={"shown_as": "披头士", "about": "Four lads."}
    )

    assert saved.status_code == 204
    [beatles] = client.get("/api/artist-names").json()["artists"]
    assert (beatles["shown_as"], beatles["about"]) == ("披头士", "Four lads.")


def test_the_household_s_photo_of_an_artist_is_set_and_removed(
    client: TestClient, units: sessionmaker[Session]
) -> None:
    set_up_as_alice(client)
    _beatles_known(units)

    set_photo = client.put("/api/artists/b10bbbfc/photo", content=png_image("Beatles"))
    with_photo = client.get("/api/artist-names").json()["artists"][0]
    removed = client.delete("/api/artists/b10bbbfc/photo")
    without = client.get("/api/artist-names").json()["artists"][0]

    assert (set_photo.status_code, removed.status_code) == (204, 204)
    assert with_photo["own_photo"] is True
    assert client.get(f"/api/covers/{with_photo['photo']}").status_code == 200
    assert (without["own_photo"], without["photo"]) == (False, None)


def test_a_photo_that_is_no_image_is_refused(
    client: TestClient, units: sessionmaker[Session]
) -> None:
    set_up_as_alice(client)
    _beatles_known(units)

    response = client.put("/api/artists/b10bbbfc/photo", content=gif_image())

    assert response.status_code == 422


@pytest.mark.parametrize(
    ("shown_as", "about", "status"),
    [("x" * 512, "x" * 1000, 204), ("x" * 513, None, 422), (None, "x" * 1001, 422)],
    ids=["at-the-limits", "name-too-long", "note-too-long"],
)
def test_an_artist_s_details_are_kept_up_to_their_limits(
    client: TestClient,
    units: sessionmaker[Session],
    shown_as: str | None,
    about: str | None,
    status: int,
) -> None:
    set_up_as_alice(client)
    _beatles_known(units)

    response = client.put(
        "/api/artists/b10bbbfc/details", json={"shown_as": shown_as, "about": about}
    )

    assert response.status_code == status


def test_a_photo_past_10_mib_is_refused(client: TestClient, units: sessionmaker[Session]) -> None:
    set_up_as_alice(client)
    _beatles_known(units)

    response = client.put("/api/artists/b10bbbfc/photo", content=b"\0" * (MAX_COVER_BYTES + 1))

    assert response.status_code == 413


def test_an_artist_id_past_64_characters_is_refused(client: TestClient) -> None:
    set_up_as_alice(client)

    response = client.put(f"/api/artists/{'x' * 65}/details", json={"shown_as": "Anyone"})

    assert response.status_code == 422


def test_an_artist_no_site_named_is_not_found(client: TestClient) -> None:
    set_up_as_alice(client)

    response = client.put("/api/artists/nobody/details", json={"shown_as": "Anyone"})

    assert response.status_code == 404


def test_choosing_for_an_artist_is_for_signed_in_accounts(client: TestClient) -> None:
    response = client.put("/api/artists/b10bbbfc/details", json={"shown_as": "Anyone"})

    assert response.status_code == 401


def test_nothing_is_suggested_for_an_artist_no_ai_model_was_asked_about(
    client: TestClient, units: sessionmaker[Session]
) -> None:
    set_up_as_alice(client)
    _beatles_known(units)

    response = client.get("/api/artists/b10bbbfc/suggestion")

    assert response.json() == {
        "asking": False,
        "waiting": False,
        "suggestion": None,
        "failure": None,
    }


def test_what_an_ai_model_last_suggested_for_an_artist_is_shown(
    client: TestClient, units: sessionmaker[Session]
) -> None:
    set_up_as_alice(client)
    _beatles_known(units)
    with units.begin() as db:
        db.add(
            ArtistSuggestionRow(
                artist_id="b10bbbfc",
                offered=["The Beatles"],
                shown_as="The Beatles",
                why="The songs are English",
                about="An English rock band.",
                model="deepseek-flash",
                host="api.deepseek.com",
                answered_at=datetime(2026, 11, 2, tzinfo=UTC),
            )
        )

    suggestion = client.get("/api/artists/b10bbbfc/suggestion").json()["suggestion"]

    assert suggestion == {
        "shown_as": "The Beatles",
        "why": "The songs are English",
        "about": "An English rock band.",
        "model": "deepseek-flash",
        "host": "api.deepseek.com",
        "at": "2026-11-02T00:00:00Z",
    }


def test_no_ai_model_is_asked_about_an_artist_while_the_ai_plugin_is_off(
    client: TestClient, units: sessionmaker[Session]
) -> None:
    set_up_as_alice(client)
    _beatles_known(units)

    response = client.post("/api/artists/b10bbbfc/suggestion")

    assert response.status_code == 409


def test_an_artist_no_site_named_has_no_suggestion(client: TestClient) -> None:
    set_up_as_alice(client)

    response = client.get("/api/artists/nobody/suggestion")

    assert response.status_code == 404


def test_suggestions_are_for_signed_in_accounts(client: TestClient) -> None:
    assert client.get("/api/artists/b10bbbfc/suggestion").status_code == 401
    assert client.post("/api/artists/b10bbbfc/suggestion").status_code == 401
