"""The settings API: everyone reads the settings; an admin replaces them at the revision read."""

from fastapi.testclient import TestClient

from medleyplay.domain.settings import DEFAULT_AI_NOTES
from tests.support.api import add_bob, set_up_as_alice, sign_in

TWENTY_GIB = 20 * 1024**3


def test_settings_never_saved_read_as_no_limit_at_revision_0(client: TestClient) -> None:
    set_up_as_alice(client)

    response = client.get("/api/settings")

    assert response.json() == {
        "storage_limit": None,
        "removal_order": "least_favorite",
        "album_minutes": 20,
        "split_albums": "approval",
        "lyrics_sites": [],
        "suggest_lyrics": True,
        "picture_sites": [],
        "pick_pictures_by_ai": False,
        "find_artist_photos": "up_next",
        "find_album_covers": "up_next",
        "pick_album_covers_by_ai": False,
        "ai_notes": [{"ask": note.ask, "text": note.text} for note in DEFAULT_AI_NOTES],
        "revision": 0,
    }


def test_an_admin_turns_lyrics_suggestions_off_keeping_the_rest(client: TestClient) -> None:
    set_up_as_alice(client)

    saved = client.put(
        "/api/settings", json={"storage_limit": None, "suggest_lyrics": False, "revision": 0}
    )

    assert (saved.json()["suggest_lyrics"], saved.json()["album_minutes"]) == (False, 20)


def test_an_admin_saves_a_limit_at_the_revision_read(client: TestClient) -> None:
    set_up_as_alice(client)

    saved = client.put("/api/settings", json={"storage_limit": TWENTY_GIB, "revision": 0})

    assert (saved.status_code, saved.json()["storage_limit"], saved.json()["revision"]) == (
        200,
        TWENTY_GIB,
        1,
    )
    assert client.get("/api/settings").json() == saved.json()


def test_saving_at_a_revision_someone_saved_since_is_a_conflict(client: TestClient) -> None:
    set_up_as_alice(client)
    client.put("/api/settings", json={"storage_limit": TWENTY_GIB, "revision": 0})

    stale = client.put("/api/settings", json={"storage_limit": 0, "revision": 0})

    assert stale.status_code == 409
    assert "revision 0" in stale.json()["detail"]
    assert client.get("/api/settings").json()["storage_limit"] == TWENTY_GIB


def test_a_member_reads_the_settings_but_cannot_change_them(client: TestClient) -> None:
    set_up_as_alice(client)
    add_bob(client)
    sign_in(client, "bob")

    read = client.get("/api/settings")
    changed = client.put("/api/settings", json={"storage_limit": 0, "revision": 0})

    assert (read.status_code, changed.status_code) == (200, 403)


def test_a_negative_limit_is_refused(client: TestClient) -> None:
    set_up_as_alice(client)

    response = client.put("/api/settings", json={"storage_limit": -1, "revision": 0})

    assert response.status_code == 422


def test_an_admin_turns_off_guessing_albums_from_their_length(client: TestClient) -> None:
    set_up_as_alice(client)

    saved = client.put(
        "/api/settings", json={"storage_limit": None, "album_minutes": None, "revision": 0}
    )

    assert saved.json()["album_minutes"] is None


def test_saving_without_the_album_length_keeps_the_one_saved(client: TestClient) -> None:
    set_up_as_alice(client)
    client.put("/api/settings", json={"storage_limit": None, "album_minutes": None, "revision": 0})

    saved = client.put("/api/settings", json={"storage_limit": TWENTY_GIB, "revision": 1})

    assert (saved.json()["storage_limit"], saved.json()["album_minutes"]) == (TWENTY_GIB, None)


def test_an_admin_has_long_files_split_by_a_list_that_can_be_trusted(client: TestClient) -> None:
    set_up_as_alice(client)

    saved = client.put(
        "/api/settings", json={"storage_limit": None, "split_albums": "auto", "revision": 0}
    )

    assert saved.json()["split_albums"] == "auto"


def test_saving_without_what_becomes_of_long_files_keeps_the_choice_saved(
    client: TestClient,
) -> None:
    set_up_as_alice(client)
    client.put("/api/settings", json={"storage_limit": None, "split_albums": "off", "revision": 0})

    saved = client.put("/api/settings", json={"storage_limit": TWENTY_GIB, "revision": 1})

    assert saved.json()["split_albums"] == "off"


def test_what_becomes_of_long_files_is_one_of_three_choices(client: TestClient) -> None:
    set_up_as_alice(client)

    refused = client.put(
        "/api/settings", json={"storage_limit": None, "split_albums": "always", "revision": 0}
    )

    assert refused.status_code == 422


def test_an_admin_turns_on_netease_for_lyrics_and_saving_without_it_keeps_it_on(
    client: TestClient,
) -> None:
    set_up_as_alice(client)
    turned_on = client.put(
        "/api/settings", json={"storage_limit": None, "lyrics_sites": ["netease"], "revision": 0}
    )

    saved = client.put("/api/settings", json={"storage_limit": TWENTY_GIB, "revision": 1})

    assert turned_on.json()["lyrics_sites"] == ["netease"]
    assert saved.json()["lyrics_sites"] == ["netease"]


def test_an_unknown_lyrics_site_is_refused(client: TestClient) -> None:
    set_up_as_alice(client)

    refused = client.put(
        "/api/settings", json={"storage_limit": None, "lyrics_sites": ["qq"], "revision": 0}
    )

    assert refused.status_code == 422


def test_an_admin_turns_on_deezer_for_artist_pictures_and_saving_without_it_keeps_it_on(
    client: TestClient,
) -> None:
    set_up_as_alice(client)
    turned_on = client.put(
        "/api/settings", json={"storage_limit": None, "picture_sites": ["deezer"], "revision": 0}
    )

    saved = client.put("/api/settings", json={"storage_limit": TWENTY_GIB, "revision": 1})

    assert turned_on.json()["picture_sites"] == ["deezer"]
    assert saved.json()["picture_sites"] == ["deezer"]


def test_an_admin_has_pictures_picked_by_ai_and_saving_without_it_keeps_it(
    client: TestClient,
) -> None:
    set_up_as_alice(client)
    turned_on = client.put(
        "/api/settings", json={"storage_limit": None, "pick_pictures_by_ai": True, "revision": 0}
    )

    saved = client.put("/api/settings", json={"storage_limit": TWENTY_GIB, "revision": 1})

    assert turned_on.json()["pick_pictures_by_ai"] is True
    assert saved.json()["pick_pictures_by_ai"] is True


def test_an_unknown_picture_site_is_refused(client: TestClient) -> None:
    set_up_as_alice(client)

    refused = client.put(
        "/api/settings", json={"storage_limit": None, "picture_sites": ["spotify"], "revision": 0}
    )

    assert refused.status_code == 422


def test_an_admin_has_every_missing_album_cover_found_and_saving_without_it_keeps_it(
    client: TestClient,
) -> None:
    set_up_as_alice(client)
    chosen = client.put(
        "/api/settings",
        json={
            "storage_limit": None,
            "find_album_covers": "missing",
            "pick_album_covers_by_ai": True,
            "revision": 0,
        },
    )

    saved = client.put("/api/settings", json={"storage_limit": TWENTY_GIB, "revision": 1})

    assert (chosen.json()["find_album_covers"], chosen.json()["pick_album_covers_by_ai"]) == (
        "missing",
        True,
    )
    assert (saved.json()["find_album_covers"], saved.json()["pick_album_covers_by_ai"]) == (
        "missing",
        True,
    )


def test_finding_album_covers_is_one_of_three_choices(client: TestClient) -> None:
    set_up_as_alice(client)

    refused = client.put(
        "/api/settings",
        json={"storage_limit": None, "find_album_covers": "always", "revision": 0},
    )

    assert refused.status_code == 422


def test_an_admin_edits_the_notes_offered_to_the_ai_and_saving_without_them_keeps_them(
    client: TestClient,
) -> None:
    set_up_as_alice(client)
    notes = [{"ask": "songs", "text": "A concert: one song per chapter."}]
    chosen = client.put(
        "/api/settings", json={"storage_limit": None, "ai_notes": notes, "revision": 0}
    )

    saved = client.put("/api/settings", json={"storage_limit": TWENTY_GIB, "revision": 1})

    assert chosen.json()["ai_notes"] == notes
    assert saved.json()["ai_notes"] == notes
