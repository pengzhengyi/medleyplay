"""The web client: its page at every path outside `/api`, its assets, and a hint before a build."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from medleyplay.web.app import create_app
from medleyplay.web.deps import Services
from tests.conftest import TEST_HOST

PAGE = "<!doctype html><title>medleyplay</title>"
SCRIPT = "export const songs = [];\n" * 200
"""A script of about 5 KB, large enough to be worth compressing."""


def _built(folder: Path) -> Path:
    """A built client: `index.html`, a tiny `assets/index-1a2b.js`, and `assets/songs-3c4d.js`."""
    (folder / "assets").mkdir(parents=True)
    (folder / "index.html").write_text(PAGE)
    (folder / "assets" / "index-1a2b.js").write_text("console.log('hi')")
    (folder / "assets" / "songs-3c4d.js").write_text(SCRIPT)
    return folder


@pytest.fixture
def pages(services: Services, tmp_path: Path) -> TestClient:
    """A client of a server whose web client is built."""
    app = create_app(services, [TEST_HOST], client_dir=_built(tmp_path / "built"))
    return TestClient(app, base_url=f"http://{TEST_HOST}")


@pytest.mark.parametrize("path", ["/", "/index.html", "/queue", "/tracks/7"])
def test_every_path_outside_the_api_answers_the_page_revalidated(
    pages: TestClient, path: str
) -> None:
    response = pages.get(path)

    assert (response.status_code, response.text) == (200, PAGE)
    assert response.headers["cache-control"] == "no-cache"


def test_an_asset_is_kept_for_good(pages: TestClient) -> None:
    response = pages.get("/assets/index-1a2b.js")

    assert response.status_code == 200
    assert response.headers["cache-control"] == "public, max-age=31536000, immutable"


def test_an_asset_is_sent_gzipped_to_a_browser_that_accepts_it(pages: TestClient) -> None:
    response = pages.get("/assets/songs-3c4d.js", headers={"Accept-Encoding": "gzip"})

    assert response.headers["content-encoding"] == "gzip"
    assert "Accept-Encoding" in response.headers["vary"]
    assert response.text == SCRIPT
    assert response.headers["cache-control"] == "public, max-age=31536000, immutable"


def test_an_asset_is_sent_as_it_is_to_a_browser_that_does_not_accept_gzip(
    pages: TestClient,
) -> None:
    response = pages.get("/assets/songs-3c4d.js", headers={"Accept-Encoding": "identity"})

    assert "content-encoding" not in response.headers
    assert response.text == SCRIPT


def test_a_range_of_an_asset_is_sent_as_it_is(pages: TestClient) -> None:
    response = pages.get(
        "/assets/songs-3c4d.js", headers={"Accept-Encoding": "gzip", "Range": "bytes=0-5"}
    )

    assert (response.status_code, response.text) == (206, "export")
    assert "content-encoding" not in response.headers


def test_a_browser_asking_whether_its_asset_changed_is_told_to_keep_it_for_good(
    pages: TestClient,
) -> None:
    held = pages.get("/assets/index-1a2b.js")

    again = pages.get("/assets/index-1a2b.js", headers={"If-None-Match": held.headers["etag"]})

    assert again.status_code == 304
    assert again.headers["cache-control"] == "public, max-age=31536000, immutable"


def test_a_missing_asset_is_not_found(pages: TestClient) -> None:
    assert pages.get("/assets/index-old.js").status_code == 404


@pytest.mark.parametrize("path", ["/api", "/api/nothing-here"])
def test_an_api_path_no_route_matches_answers_a_json_404(pages: TestClient, path: str) -> None:
    response = pages.get(path)

    assert (response.status_code, response.json()) == (404, {"detail": "Not Found"})


def test_the_api_still_answers_its_own_routes(pages: TestClient) -> None:
    assert pages.get("/api/tracks").status_code == 401


def test_a_server_without_a_built_client_says_how_to_build_it(client: TestClient) -> None:
    response = client.get("/")

    assert response.status_code == 200
    assert "npm run build" in response.text


def test_a_server_without_a_built_client_still_answers_api_misses_as_json(
    client: TestClient,
) -> None:
    assert client.get("/api/nothing-here").json() == {"detail": "Not Found"}
