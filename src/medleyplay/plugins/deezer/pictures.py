"""Deezer, asked through its public API for pictures of the artists going by a name.

The search (`GET /search/artist`) needs no key. Its artists are taken the most followed
first, each with the 1000-pixel picture Deezer keeps of it, fetched only over HTTPS from
Deezer's own image site; an artist with Deezer's blank picture, or none, is left out, as
is a picture that is no image or longer than a cover may be.

The client is polite: one request at a time, a quarter of a second apart, as Deezer
allows fifty in five seconds, a User-Agent that names medleyplay and where to reach it,
and a timeout on each. A 403 is a refusal; a busy answer fails the finding without
asking again; an answer it can't use is an error.
"""

import time
from collections.abc import Callable
from http import HTTPStatus
from pathlib import Path
from typing import Final
from urllib.parse import urlsplit

import requests
from pydantic import BaseModel, ConfigDict, ValidationError

from medleyplay.plugin_api import (
    MAX_COVER_BYTES,
    MAX_NAME,
    MAX_PICTURES,
    FindPictures,
    FindStatus,
    FoundPicture,
    FoundPictures,
    NetworkError,
    is_cover_image,
)
from medleyplay.plugins.lyrics.lrclib import USER_AGENT

SEARCH: Final = "https://api.deezer.com/search/artist"
RESULTS: Final = 25
"""How many artists a search asks for."""
SPACING: Final = 0.25
"""The least time, in seconds, between two requests."""
TIMEOUT: Final = 10.0
IMAGE_SITE: Final = ".dzcdn.net"
"""Where Deezer keeps its pictures; a picture anywhere else is never fetched."""
BUSY_CODE: Final = 4
"""The code Deezer answers when it is asked too often."""

type Sleep = Callable[[float], None]
type Clock = Callable[[], float]


class _Artist(BaseModel):
    """An artist as Deezer's search lists it."""

    model_config = ConfigDict(extra="ignore")

    id: int
    name: str = ""
    picture_xl: str | None = None
    nb_fan: int | None = None


class _Search(BaseModel):
    model_config = ConfigDict(extra="ignore")

    data: list[_Artist]


class _RefusedError(Exception):
    """Deezer refused the request, so nothing more should be asked of it for now."""


class DeezerPictures:
    """Finds pictures of the artists going by a name on Deezer."""

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

    def find(self, request: FindPictures) -> FoundPictures:
        """Answer the pictures of the artists going by the name, each written into the folder."""
        try:
            artists = self._search(request.artist)
        except _RefusedError as error:
            return FoundPictures(status=FindStatus.REFUSED, message=str(error))
        pictures: list[FoundPicture] = []
        for each in sorted(artists, key=lambda artist: -(artist.nb_fan or 0)):
            if len(pictures) == MAX_PICTURES:
                break
            data = self._picture(each.picture_xl)
            if data is None:
                continue
            file = f"{each.id}.jpg"
            (Path(request.folder) / file).write_bytes(data)
            fans = None if each.nb_fan is None else max(each.nb_fan, 0)
            pictures.append(FoundPicture(name=each.name[:MAX_NAME], fans=fans, file=file))
        return FoundPictures(pictures=tuple(pictures))

    def _search(self, name: str) -> list[_Artist]:
        response = self._get(SEARCH, {"q": name, "limit": str(RESULTS)})
        status = response.status_code
        if status == HTTPStatus.FORBIDDEN:
            message = "Deezer refused the request (HTTP 403)."
            raise _RefusedError(message)
        if status == HTTPStatus.TOO_MANY_REQUESTS or status >= HTTPStatus.INTERNAL_SERVER_ERROR:
            message = f"Deezer was too busy to answer (HTTP {status})."
            raise NetworkError(message)
        try:
            found: object = response.json()
        except ValueError as error:
            message = "Deezer answered something other than JSON."
            raise ValueError(message) from error
        said = found.get("error") if isinstance(found, dict) else None
        if isinstance(said, dict):
            if said.get("code") == BUSY_CODE:
                message = "Deezer was too busy to answer."
                raise NetworkError(message)
            message = f"Deezer couldn't answer: {str(said.get('message', ''))[:200]}"
            raise ValueError(message)  # noqa: TRY004 -- an answer it can't use, as the others
        try:
            return _Search.model_validate(found).data
        except ValidationError as error:
            message = "Deezer answered a search of another shape."
            raise ValueError(message) from error

    def _picture(self, url: str | None) -> bytes | None:
        """Return the picture at `url`, if it is Deezer's, and an image no longer than a cover."""
        if not url or "/artist//" in url:
            return None
        parts = urlsplit(url)
        if parts.scheme != "https" or not (parts.hostname or "").endswith(IMAGE_SITE):
            return None
        try:
            response = self._get(url, stream=True)
        except NetworkError:
            return None
        with response:
            if response.status_code != HTTPStatus.OK:
                return None
            data = _read_at_most(response, MAX_COVER_BYTES)
        return data if data is not None and is_cover_image(data) else None

    def _get(
        self, url: str, params: dict[str, str] | None = None, *, stream: bool = False
    ) -> requests.Response:
        self._pace()
        try:
            return self._session.get(
                url, params=params, timeout=TIMEOUT, stream=stream, allow_redirects=False
            )
        except requests.RequestException as error:
            message = f"Deezer couldn't be reached: {type(error).__name__}."
            raise NetworkError(message) from error

    def _pace(self) -> None:
        now = self._clock()
        if now < self._next_at:
            self._sleep(self._next_at - now)
            now = self._next_at
        self._next_at = now + SPACING


def _read_at_most(response: requests.Response, limit: int) -> bytes | None:
    """Return the body, or `None` as soon as it is longer than `limit` bytes."""
    body = bytearray()
    for chunk in response.iter_content(chunk_size=64 * 1024):
        body += chunk
        if len(body) > limit:
            return None
    return bytes(body)
