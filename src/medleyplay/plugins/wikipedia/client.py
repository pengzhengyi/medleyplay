"""A small client for Wikidata's API.

It is polite by construction: one request at a time, at least a second apart, with a
User-Agent that names medleyplay and where to reach it, and a timeout on every
request. A 403 or 429 means Wikidata wants no more requests for now, which is a
refusal.
"""

import time
from collections.abc import Callable
from http import HTTPStatus
from importlib.metadata import version
from typing import Final

import requests

from medleyplay.plugin_api import NetworkError
from medleyplay.plugins.wikipedia.models import Entities, Entity, Search

API: Final = "https://www.wikidata.org/w/api.php"
USER_AGENT: Final = (
    f"medleyplay/{version('medleyplay')} ( https://github.com/pengzhengyi/medleyplay )"
)
"""What Wikimedia asks of a client: its name, version, and a way to reach it."""
SPACING: Final = 1.0
"""The least time, in seconds, between two requests."""
TIMEOUT: Final = 10.0
"""How long, in seconds, one request may take to connect and to answer."""
MUSICBRAINZ_ARTIST: Final = "P434"
"""Wikidata's property holding an item's MusicBrainz artist id."""
LANGUAGES: Final = (
    "zh",
    "zh-hans",
    "zh-hant",
    "zh-cn",
    "zh-tw",
    "zh-hk",
    "zh-sg",
    "zh-mo",
    "yue",
    "ja",
    "ko",
    "en",
)
"""The languages whose names are asked for: those the household's Library is written in."""

type Sleep = Callable[[float], None]
type Clock = Callable[[], float]


class RefusedError(Exception):
    """Wikidata refused the request, so nothing more should be asked of it for now."""


class WikidataClient:
    """Finds the item of a MusicBrainz artist, and reads an item's names."""

    def __init__(
        self,
        session: requests.Session | None = None,
        *,
        sleep: Sleep = time.sleep,
        clock: Clock = time.monotonic,
    ) -> None:
        """Create a client over `session`; `sleep` and `clock` pace its requests."""
        self._session = session or requests.Session()
        self._session.headers["User-Agent"] = USER_AGENT
        self._sleep = sleep
        self._clock = clock
        self._next_at = 0.0

    def item_of(self, musicbrainz_id: str) -> str | None:
        """Return the id of the item whose MusicBrainz artist id is `musicbrainz_id`, if one."""
        found = Search.model_validate(
            self._json(
                {
                    "action": "query",
                    "list": "search",
                    "srsearch": f"haswbstatement:{MUSICBRAINZ_ARTIST}={musicbrainz_id}",
                    "srlimit": "1",
                    "srprop": "",
                }
            )
        )
        return found.query.search[0].title if found.query.search else None

    def entity(self, item: str) -> Entity | None:
        """Return the item `item` with its labels and aliases, or `None` if Wikidata lacks it."""
        found = Entities.model_validate(
            self._json(
                {
                    "action": "wbgetentities",
                    "ids": item,
                    "props": "labels|aliases",
                    "languages": "|".join(LANGUAGES),
                }
            )
        )
        entity = next(iter(found.entities.values()), None)
        return None if entity is None or entity.missing is not None else entity

    def _json(self, params: dict[str, str]) -> object:
        self._pace()
        try:
            response = self._session.get(API, params={**params, "format": "json"}, timeout=TIMEOUT)
        except requests.RequestException as error:
            message = f"Wikidata couldn't be reached: {type(error).__name__}."
            raise NetworkError(message) from error
        status = response.status_code
        if status in {HTTPStatus.FORBIDDEN, HTTPStatus.TOO_MANY_REQUESTS}:
            message = f"Wikidata refused the request ({status})."
            raise RefusedError(message)
        if status >= HTTPStatus.BAD_REQUEST:
            message = f"Wikidata answered {status}."
            raise NetworkError(message)
        try:
            body: object = response.json()
        except requests.JSONDecodeError as error:
            # Such as a network's sign-in page, answering in Wikidata's place.
            message = "The answer was not Wikidata's: it was not JSON."
            raise NetworkError(message) from error
        if isinstance(body, dict) and "error" in body:
            message = "Wikidata couldn't answer the request."
            raise NetworkError(message)
        return body

    def _pace(self) -> None:
        """Wait until a second has passed since the request before."""
        now = self._clock()
        if now < self._next_at:
            self._sleep(self._next_at - now)
            now = self._next_at
        self._next_at = now + SPACING
