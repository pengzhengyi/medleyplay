"""A small client for MusicBrainz's web service and the Cover Art Archive.

It is polite by construction: one request at a time, at least a second apart, with a
User-Agent that names medleyplay and where to reach it, a timeout on every request,
and `fmt=json`. A 503 is MusicBrainz's rate limit, so the client waits as long as
`Retry-After` says, a few times, and then gives up as a network failure; a 403 means
MusicBrainz blocked medleyplay, which is a refusal.
"""

import time
from collections.abc import Callable
from http import HTTPStatus
from importlib.metadata import version
from typing import Final

import requests

from medleyplay.plugin_api import MAX_COVER_BYTES, NetworkError, is_cover_image
from medleyplay.plugins.musicbrainz.models import (
    RecordingSearch,
    Release,
    ReleaseSearch,
)

API: Final = "https://musicbrainz.org/ws/2"
COVERS: Final = "https://coverartarchive.org"
USER_AGENT: Final = (
    f"medleyplay/{version('medleyplay')} ( https://github.com/pengzhengyi/medleyplay )"
)
"""What MusicBrainz asks of an application: its name, version, and a way to reach it."""
SPACING: Final = 1.0
"""The least time, in seconds, between two requests."""
TIMEOUT: Final = 10.0
"""How long, in seconds, one request may take to connect and to answer."""
MAX_ATTEMPTS: Final = 3
"""How many times a request is sent while MusicBrainz answers 503."""
MAX_WAIT: Final = 10.0
"""The longest `Retry-After`, in seconds, the client waits out; a longer one is a failure."""
DEFAULT_WAIT: Final = 2.0
SEARCH_LIMIT: Final = 25
"""How many recordings, or releases, a search asks for."""
MAX_REDIRECTS: Final = 5

type Sleep = Callable[[float], None]
type Clock = Callable[[], float]


class RefusedError(Exception):
    """MusicBrainz refused the request, so nothing more should be asked of it."""


class MusicBrainzClient:
    """Searches recordings and releases, looks a release up, and fetches its front cover."""

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
        self._session.max_redirects = MAX_REDIRECTS
        self._sleep = sleep
        self._clock = clock
        self._next_at = 0.0

    def search_recordings(self, query: str) -> RecordingSearch:
        """Return the recordings that match the Lucene `query`, best first."""
        found = self._json(f"{API}/recording", {"query": query, "limit": str(SEARCH_LIMIT)})
        return RecordingSearch.model_validate(found)

    def search_releases(self, query: str) -> ReleaseSearch:
        """Return the releases that match the Lucene `query`, best first."""
        found = self._json(f"{API}/release", {"query": query, "limit": str(SEARCH_LIMIT)})
        return ReleaseSearch.model_validate(found)

    def release(self, release_id: str) -> Release | None:
        """Return the release with its tracks and artist credits, or `None` if it is gone."""
        found = self._json(
            f"{API}/release/{release_id}",
            {"inc": "recordings+artist-credits+media"},
            missing_ok=True,
        )
        return None if found is None else Release.model_validate(found)

    def front_cover(self, release_id: str) -> bytes | None:
        """Return the release's front cover, 500 pixels wide, or `None` when there is no cover.

        The Cover Art Archive redirects to the image. A cover that can't be fetched,
        is larger than a cover may be, or is no image is no cover.
        """
        self._pace()
        try:
            with self._session.get(
                f"{COVERS}/release/{release_id}/front-500", timeout=TIMEOUT, stream=True
            ) as response:
                if not response.ok:
                    return None
                data = _read_at_most(response, MAX_COVER_BYTES)
        except requests.RequestException:
            return None
        return data if data is not None and is_cover_image(data) else None

    def _json(self, url: str, params: dict[str, str], *, missing_ok: bool = False) -> object | None:
        for attempt in range(1, MAX_ATTEMPTS + 1):
            self._pace()
            try:
                response = self._session.get(url, params={**params, "fmt": "json"}, timeout=TIMEOUT)
            except requests.RequestException as error:
                message = f"MusicBrainz couldn't be reached: {type(error).__name__}."
                raise NetworkError(message) from error
            if response.status_code == HTTPStatus.SERVICE_UNAVAILABLE:
                self._wait_out(response, attempt)
                continue
            return _answer(response, missing_ok=missing_ok)
        message = "MusicBrainz was too busy to answer."
        raise NetworkError(message)

    def _wait_out(self, response: requests.Response, attempt: int) -> None:
        """Wait as long as MusicBrainz asked, unless that is too long or there are no tries left."""
        wait = _retry_after(response)
        if wait > MAX_WAIT or attempt == MAX_ATTEMPTS:
            message = "MusicBrainz was too busy to answer."
            raise NetworkError(message)
        self._sleep(wait)

    def _pace(self) -> None:
        """Wait until a second has passed since the request before."""
        now = self._clock()
        if now < self._next_at:
            self._sleep(self._next_at - now)
            now = self._next_at
        self._next_at = now + SPACING


def _answer(response: requests.Response, *, missing_ok: bool) -> object | None:
    status = response.status_code
    if status == HTTPStatus.FORBIDDEN:
        message = "MusicBrainz refused the request (403)."
        raise RefusedError(message)
    if status == HTTPStatus.NOT_FOUND and missing_ok:
        return None
    if status >= HTTPStatus.INTERNAL_SERVER_ERROR:
        message = f"MusicBrainz answered {status}."
        raise NetworkError(message)
    response.raise_for_status()
    try:
        body: object = response.json()
    except requests.JSONDecodeError as error:
        # Such as a network's sign-in page, answering in MusicBrainz's place.
        message = "The answer was not MusicBrainz's: it was not JSON."
        raise NetworkError(message) from error
    return body


def _retry_after(response: requests.Response) -> float:
    try:
        return max(float(response.headers.get("Retry-After", "")), 0.0)
    except ValueError:
        return DEFAULT_WAIT


def _read_at_most(response: requests.Response, limit: int) -> bytes | None:
    """Return the body, or `None` as soon as it is longer than `limit` bytes."""
    body = bytearray()
    for chunk in response.iter_content(chunk_size=64 * 1024):
        body += chunk
        if len(body) > limit:
            return None
    return bytes(body)
