"""Find source-linked pictures through Tavily's fixed search endpoint."""

import json
from collections.abc import Iterator, Sequence
from dataclasses import dataclass, field
from http import HTTPStatus
from typing import Final

import requests

from medleyplay.plugin_api import (
    MAX_IMAGE_LINKS,
    MAX_NAME,
    FindStatus,
    NetworkError,
    Plugin,
    Registry,
    is_public_address,
    public_host,
    resolve_host,
)
from medleyplay.plugin_api.image_search import (
    IMAGE_SEARCHER,
    TAVILY,
    PictureCandidate,
    PictureResults,
    SearchPictures,
)
from medleyplay.plugin_api.public_fetch import Resolve

_SEARCH: Final = "https://api.tavily.com/search"
_MAX_PAGES: Final = 5
_MAX_BYTES: Final = 1024 * 1024


@dataclass(frozen=True)
class TavilyPictures:
    """Search once without following redirects or fetching any result."""

    session: requests.Session = field(default_factory=requests.Session)
    resolve: Resolve = resolve_host

    def __post_init__(self) -> None:
        """Use only the lent credential, not netrc or an environment proxy."""
        self.session.trust_env = False

    def search(self, request: SearchPictures) -> PictureResults:
        """Return only images attached to an individual result with a public source page."""
        purpose = "album cover" if request.album else "artist photo"
        names = " ".join(f"{request.album} {request.artist}".split())
        key = request.key.get_secret_value()
        try:
            with self.session.post(
                _SEARCH,
                headers={"Authorization": f"Bearer {key}"},
                json={
                    "query": f"{purpose} {names}"[:400],
                    "search_depth": "basic",
                    "max_results": _MAX_PAGES,
                    "include_images": True,
                },
                timeout=(5, 20),
                allow_redirects=False,
                stream=True,
            ) as response:
                if response.status_code >= HTTPStatus.INTERNAL_SERVER_ERROR:
                    message = "Tavily is unavailable."
                    raise NetworkError(message)
                if response.status_code != HTTPStatus.OK:
                    return PictureResults(status=FindStatus.REFUSED)
                data = _read_results(response)
        except requests.RequestException:
            message = "Tavily could not be reached."
            raise NetworkError(message) from None
        return PictureResults(images=self._public_candidates(data, key))

    def _public_candidates(self, pages: Sequence[object], key: str) -> tuple[PictureCandidate, ...]:
        public: dict[str, bool] = {}

        def allowed(url: str) -> bool:
            host = public_host(url)
            if not host:
                return False
            if host not in public:
                try:
                    addresses = self.resolve(host)
                except OSError:
                    addresses = ()
                public[host] = bool(addresses) and all(map(is_public_address, addresses))
            return public[host]

        found: dict[str, PictureCandidate] = {}
        for url, page, title in _source_images(pages):
            if url in found or any(key in value for value in (url, page, title)):
                continue
            if allowed(page) and allowed(url):
                found[url] = PictureCandidate(url=url, page=page, title=title[:MAX_NAME])
            if len(found) == MAX_IMAGE_LINKS:
                break
        return tuple(found.values())


def _read_results(response: requests.Response) -> list[object]:
    message = "Tavily returned an invalid search response."
    body = bytearray()
    for chunk in response.iter_content(chunk_size=65536):
        body.extend(chunk)
        if len(body) > _MAX_BYTES:
            raise ValueError(message)
    try:
        data: object = json.loads(body)
    except (ValueError, RecursionError):
        raise ValueError(message) from None
    if not isinstance(data, dict) or not isinstance(pages := data.get("results"), list):
        raise TypeError(message)
    return pages[:_MAX_PAGES]


def _source_images(pages: Sequence[object]) -> Iterator[tuple[str, str, str]]:
    for result in pages:
        if not isinstance(result, dict):
            continue
        page, images, title = result.get("url"), result.get("images"), result.get("title")
        if not isinstance(page, str) or not isinstance(images, list):
            continue
        for image in images[:MAX_IMAGE_LINKS]:
            url = image.get("url") if isinstance(image, dict) else image
            if isinstance(url, str):
                yield url, page, title if isinstance(title, str) else ""


def register(registry: Registry) -> None:
    """Register the Tavily picture searcher."""
    registry.add(IMAGE_SEARCHER, TAVILY, TavilyPictures())


plugin = Plugin(api_version=1, register=register)
