"""The covers API: uploading the household's cover, and serving a cover or its thumbnail."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from medleyplay.application.catalog import CatalogService
from medleyplay.domain.catalog import TrackId
from medleyplay.domain.covers import MAX_COVER_BYTES, THUMBNAIL_RECIPE, cover_id
from tests.support.api import set_up_as_alice
from tests.support.factories import SourceKeyFactory, TrackDetailsFactory

PNG = b"\x89PNG\r\n\x1a\n" + b"cover of Bremen"
"""A PNG image's bytes, as far as a cover needs them."""


def _one_track(catalog: CatalogService) -> TrackId:
    return catalog.add_track(SourceKeyFactory.bilibili(), TrackDetailsFactory.song())


def test_an_uploaded_cover_shows_on_the_track_as_the_households(
    client: TestClient, catalog: CatalogService
) -> None:
    set_up_as_alice(client)
    track = _one_track(catalog)

    response = client.put(f"/api/tracks/{track}/cover", content=PNG)

    assert response.status_code == 200
    assert response.json()["shown"]["cover"] == {"value": cover_id(PNG), "origin": "household"}
    assert client.get(f"/api/tracks/{track}").json()["cover"] == cover_id(PNG)


def test_a_cover_is_served_as_its_bytes_say_and_kept_by_the_browser_for_good(
    client: TestClient, catalog: CatalogService
) -> None:
    set_up_as_alice(client)
    client.put(f"/api/tracks/{_one_track(catalog)}/cover", content=PNG)

    response = client.get(f"/api/covers/{cover_id(PNG)}")

    assert response.content == PNG
    assert response.headers["content-type"] == "image/png"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["cache-control"] == "private, max-age=31536000, immutable"


def test_an_upload_other_than_an_image_is_refused(
    client: TestClient, catalog: CatalogService
) -> None:
    set_up_as_alice(client)

    response = client.put(f"/api/tracks/{_one_track(catalog)}/cover", content=b"<svg/>")

    assert response.status_code == 422


def test_an_upload_over_the_limit_is_refused_without_keeping_it(
    client: TestClient, catalog: CatalogService
) -> None:
    set_up_as_alice(client)
    track = _one_track(catalog)

    response = client.put(f"/api/tracks/{track}/cover", content=PNG + b"\0" * MAX_COVER_BYTES)

    assert response.status_code == 413
    assert client.get(f"/api/tracks/{track}").json()["cover"] is None


def test_removing_the_households_cover_shows_none_again(
    client: TestClient, catalog: CatalogService
) -> None:
    set_up_as_alice(client)
    track = _one_track(catalog)
    client.put(f"/api/tracks/{track}/cover", content=PNG)

    response = client.delete(f"/api/tracks/{track}/cover")

    assert "cover" not in response.json()["shown"]


def test_a_cover_no_one_kept_is_not_found(client: TestClient) -> None:
    set_up_as_alice(client)

    assert client.get(f"/api/covers/{'0' * 64}").status_code == 404
    assert client.get("/api/covers/cover.png").status_code == 404


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", f"/api/covers/{'0' * 64}"),
        ("PUT", "/api/tracks/1/cover"),
        ("DELETE", "/api/tracks/1/cover"),
    ],
    ids=["serving", "uploading", "removing"],
)
def test_covers_need_a_signed_in_account(client: TestClient, method: str, path: str) -> None:
    assert client.request(method, path, content=PNG).status_code == 401


SMALL_JPEG = b"\xff\xd8\xff\xe0" + b"small Bremen"
"""A small thumbnail's bytes, as far as serving it needs them."""


def _kept_with_thumbnail(client: TestClient, catalog: CatalogService, tmp_path: Path) -> str:
    """Upload *PNG* as a Track's cover, give it a small thumbnail, and return its name."""
    client.put(f"/api/tracks/{_one_track(catalog)}/cover", content=PNG)
    name = cover_id(PNG)
    made = tmp_path / "data" / "thumbnails" / str(THUMBNAIL_RECIPE)
    made.mkdir(parents=True)
    (made / f"{name}-small").write_bytes(SMALL_JPEG)
    return name


def test_a_thumbnail_made_is_served_and_kept_by_the_browser_for_good(
    client: TestClient, catalog: CatalogService, tmp_path: Path
) -> None:
    set_up_as_alice(client)
    name = _kept_with_thumbnail(client, catalog, tmp_path)

    response = client.get(f"/api/covers/{name}?size=small&recipe={THUMBNAIL_RECIPE}")

    assert response.status_code == 200
    assert response.content == SMALL_JPEG
    assert response.headers["content-type"] == "image/jpeg"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["cache-control"] == "private, max-age=31536000, immutable"


@pytest.mark.parametrize(
    "query",
    ["size=medium&recipe=1", "size=small&recipe=0", "size=small&recipe=2"],
    ids=["a size not made yet", "an older recipe", "a newer recipe"],
)
def test_a_thumbnail_not_there_sends_the_browser_to_the_original_unkept(
    client: TestClient, catalog: CatalogService, tmp_path: Path, query: str
) -> None:
    set_up_as_alice(client)
    name = _kept_with_thumbnail(client, catalog, tmp_path)

    response = client.get(f"/api/covers/{name}?{query}", follow_redirects=False)

    assert response.status_code == 307
    assert response.headers["location"] == f"/api/covers/{name}"
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.parametrize(
    "query",
    ["size=large&recipe=1", "size=small", "recipe=1"],
    ids=["an unknown size", "no recipe", "no size"],
)
def test_a_thumbnail_asked_for_wrongly_is_refused(
    client: TestClient, catalog: CatalogService, tmp_path: Path, query: str
) -> None:
    set_up_as_alice(client)
    name = _kept_with_thumbnail(client, catalog, tmp_path)

    response = client.get(f"/api/covers/{name}?{query}", follow_redirects=False)

    assert response.status_code == 422


def test_a_thumbnail_of_no_kept_image_is_not_found(client: TestClient) -> None:
    set_up_as_alice(client)

    response = client.get(f"/api/covers/{'0' * 64}?size=small&recipe=1", follow_redirects=False)

    assert response.status_code == 404


@pytest.mark.parametrize("mark", ["made", "unreadable"])
def test_an_image_done_without_a_size_sends_the_browser_to_the_original_for_good(
    client: TestClient, catalog: CatalogService, tmp_path: Path, mark: str
) -> None:
    set_up_as_alice(client)
    name = _kept_with_thumbnail(client, catalog, tmp_path)
    (tmp_path / "data" / "thumbnails" / str(THUMBNAIL_RECIPE) / f"{name}.{mark}").touch()

    response = client.get(f"/api/covers/{name}?size=medium&recipe=1", follow_redirects=False)

    assert response.status_code == 307
    assert response.headers["location"] == f"/api/covers/{name}"
    assert response.headers["cache-control"] == "private, max-age=31536000, immutable"
