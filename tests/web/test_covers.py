"""The covers API: uploading the household's cover, and serving a cover by its name."""

from fastapi.testclient import TestClient

from medleyplay.application.catalog import CatalogService
from medleyplay.domain.catalog import TrackId
from medleyplay.domain.covers import MAX_COVER_BYTES, cover_id
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


def test_covers_need_a_signed_in_account(client: TestClient) -> None:
    assert client.get(f"/api/covers/{'0' * 64}").status_code == 401
