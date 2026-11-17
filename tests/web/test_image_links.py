"""The image links API: links a model suggested for a picture, and approving one to fetch."""

from datetime import UTC, datetime
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.album_covers import album_key
from medleyplay.domain.covers import cover_id
from medleyplay.persistence.schema import ImageLinksRow
from tests.support.api import set_up_as_alice
from tests.support.images import jpeg_image

HELP = {"album": "Help!", "artist": "The Beatles"}
COVER_LINK = "https://upload.wikimedia.org/wikipedia/en/e/e7/Help.jpg"
GONE_LINK = "https://upload.wikimedia.org/wikipedia/en/0/00/Gone.jpg"
FETCHED = jpeg_image("Help! from the web")


def _help_suggested(units: sessionmaker[Session], *, cover: str | None = None) -> None:
    """Keep two links a model suggested for *Help!*'s cover, the first fetched as `cover`."""
    with units.begin() as db:
        db.add(
            ImageLinksRow(
                subject="album",
                key=album_key("Help!", "The Beatles"),
                name="Help!",
                artist="The Beatles",
                links=[
                    {"url": COVER_LINK, "page": None, "why": "Its article", "cover": cover},
                    {"url": GONE_LINK, "page": None, "why": "", "unavailable": "Gone (404)."},
                ],
                model="deepseek-flash",
                host="api.deepseek.com",
                asked_at=datetime(2026, 11, 17, tzinfo=UTC),
            )
        )


def _kept(tmp_path: Path) -> str:
    """Keep `FETCHED` in the covers folder, and return its cover."""
    covers = tmp_path / "data" / "covers"
    covers.mkdir(parents=True, exist_ok=True)
    (covers / cover_id(FETCHED)).write_bytes(FETCHED)
    return cover_id(FETCHED)


def test_nothing_is_suggested_for_an_album_until_asked(client: TestClient) -> None:
    set_up_as_alice(client)

    response = client.get("/api/image-links/album", params=HELP)

    assert response.json() == {
        "links": [],
        "model": "",
        "host": "",
        "asked_at": None,
        "asking": False,
        "waiting": False,
        "failure": None,
        "may_suggest": False,
    }


def test_the_links_suggested_are_listed_with_what_fetching_gave(
    client: TestClient, units: sessionmaker[Session], tmp_path: Path
) -> None:
    set_up_as_alice(client)
    _help_suggested(units, cover=_kept(tmp_path))

    known = client.get("/api/image-links/album", params=HELP).json()

    assert known["links"] == [
        {
            "url": COVER_LINK,
            "page": None,
            "why": "Its article",
            "cover": cover_id(FETCHED),
            "unavailable": "",
            "fetching": False,
            "failure": None,
        },
        {
            "url": GONE_LINK,
            "page": None,
            "why": "",
            "cover": None,
            "unavailable": "Gone (404).",
            "fetching": False,
            "failure": None,
        },
    ]
    assert known["model"] == "deepseek-flash"


def test_approving_a_link_fetched_before_answers_with_its_cover(
    client: TestClient, units: sessionmaker[Session], tmp_path: Path
) -> None:
    set_up_as_alice(client)
    _help_suggested(units, cover=_kept(tmp_path))

    response = client.post("/api/image-links/album/approve", json={**HELP, "url": COVER_LINK})

    assert (response.status_code, response.json()) == (202, {"cover": cover_id(FETCHED)})


def test_approving_a_link_the_model_did_not_suggest_is_not_found(
    client: TestClient, units: sessionmaker[Session]
) -> None:
    set_up_as_alice(client)
    _help_suggested(units)

    response = client.post(
        "/api/image-links/album/approve", json={**HELP, "url": "https://example.com/a.jpg"}
    )

    assert response.status_code == 404


def test_asking_without_an_ai_provider_set_up_is_a_conflict(client: TestClient) -> None:
    set_up_as_alice(client)

    response = client.post("/api/image-links/album/suggest", json=HELP)

    assert response.status_code == 409


def test_an_artist_no_site_named_is_not_found(client: TestClient) -> None:
    set_up_as_alice(client)

    response = client.get("/api/image-links/artist/not-an-artist")

    assert response.status_code == 404


def test_a_cover_not_kept_cannot_become_an_artists_photo(client: TestClient) -> None:
    set_up_as_alice(client)

    response = client.post("/api/artists/not-an-artist/photo/cover", json={"cover": "0" * 64})

    assert response.status_code == 404


def test_an_album_unnamed_is_refused(client: TestClient) -> None:
    set_up_as_alice(client)

    response = client.get("/api/image-links/album", params={"album": ""})

    assert response.status_code == 422
