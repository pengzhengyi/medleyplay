"""LRCLIB, the open lyrics database at lrclib.net, asked for a song's lyrics.

A song is asked for by its title, artist, album, and length, which LRCLIB matches
within two seconds; one it doesn't find so is searched for by its title and artist,
and the first result within two seconds of its length is taken. A song of no known
length is searched for, and the first result with its exact title and artist taken.

The client is polite as LRCLIB asks: one request at a time, half a second apart, a
User-Agent that names medleyplay and where to reach it, and a timeout on each. A 429
or 503 is waited out as `Retry-After` says, with a little jitter, a few times; a 403
is a refusal, which stops the enricher; any other answer it can't use is invalid.
"""

import secrets
import time
from collections.abc import Callable, Mapping
from http import HTTPStatus
from importlib.metadata import version
from typing import Final

import requests
from pydantic import BaseModel, ConfigDict, ValidationError

from medleyplay.plugin_api import (
    MAX_LYRICS,
    MAX_NAME,
    Enriched,
    EnrichStatus,
    EnrichTrack,
    FindLyrics,
    FindStatus,
    FoundLyrics,
    FoundLyricsOptions,
    LyricsOption,
    LyricsProvider,
    NetworkError,
)

API: Final = "https://lrclib.net/api"
GET: Final = f"{API}/get"
SEARCH: Final = f"{API}/search"
USER_AGENT: Final = (
    f"medleyplay/{version('medleyplay')} ( https://github.com/pengzhengyi/medleyplay )"
)
"""What LRCLIB asks of a client: its name, version, and a way to reach it."""
SPACING: Final = 0.5
"""The least time, in seconds, between two requests."""
TIMEOUT: Final = 10.0
MAX_ATTEMPTS: Final = 3
"""How many times a request is sent while LRCLIB says it is busy."""
MAX_WAIT: Final = 10.0
"""The longest `Retry-After`, in seconds, waited out; a longer one is a failure."""
DEFAULT_WAIT: Final = 2.0
JITTER: Final = 0.3
"""The most added to a wait, as a part of it, so clients asked to wait don't come back at once."""
MATCH_WITHIN: Final = 2.0
"""How many seconds a record's length may differ from the song's, as LRCLIB matches."""
MAX_OFFERED: Final = 5
"""The most songs LRCLIB's search offers, when the household looks for lyrics."""

type Sleep = Callable[[float], None]
type Clock = Callable[[], float]


class _Record(BaseModel):
    """A song as LRCLIB records it."""

    model_config = ConfigDict(extra="ignore")

    trackName: str = ""  # noqa: N815 -- LRCLIB's own name
    artistName: str = ""  # noqa: N815 -- LRCLIB's own name
    albumName: str = ""  # noqa: N815 -- LRCLIB's own name
    duration: float | None = None
    instrumental: bool = False
    plainLyrics: str | None = None  # noqa: N815 -- LRCLIB's own name
    syncedLyrics: str | None = None  # noqa: N815 -- LRCLIB's own name


class _RefusedError(Exception):
    """LRCLIB refused the request, so nothing more should be asked of it."""


class _InvalidError(Exception):
    """LRCLIB answered something that can't be used."""


class Lrclib:
    """Finds a song's lyrics on LRCLIB."""

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

    def enrich(self, request: EnrichTrack) -> Enriched:
        """Answer the song's lyrics, none when LRCLIB has none, or why LRCLIB said no."""
        shown = {each.field: str(each.value).strip() for each in request.shown}
        title, artist = shown.get("title", ""), shown.get("artist", "")
        if not title or not artist or request.whole_album:
            return Enriched()
        seconds = None if request.duration_ms is None else request.duration_ms / 1000
        try:
            record = self._find(title, artist, shown.get("album", ""), seconds)
        except _RefusedError as error:
            return Enriched(status=EnrichStatus.REFUSED, message=str(error))
        except _InvalidError as error:
            return Enriched(status=EnrichStatus.INVALID, message=str(error))
        return Enriched() if record is None else Enriched(lyrics=_lyrics_of(record))

    def find(self, request: FindLyrics) -> FoundLyricsOptions:
        """Answer the songs LRCLIB's search finds of the title and artist, with their lyrics.

        The closest in length to the song come first, at most a few; a song with no
        lyrics, and not instrumental, isn't offered.
        """
        params = {"track_name": request.title}
        if request.artist:
            params["artist_name"] = request.artist
        try:
            results = self._json(SEARCH, params)
        except _RefusedError as error:
            return FoundLyricsOptions(status=FindStatus.REFUSED, message=str(error))
        if not isinstance(results, list):
            message = "LRCLIB's search answered no list."
            raise _InvalidError(message)
        options = [option for each in results if (option := _option_of(_record(each))) is not None]
        return FoundLyricsOptions(
            options=tuple(closest_first(options, request.duration_ms)[:MAX_OFFERED])
        )

    def _find(self, title: str, artist: str, album: str, seconds: float | None) -> _Record | None:
        if seconds is not None:
            params = {"track_name": title, "artist_name": artist, "duration": str(round(seconds))}
            if album:
                params["album_name"] = album
            found = self._json(GET, params)
            if found is not None:
                return _record(found)
        results = self._json(SEARCH, {"track_name": title, "artist_name": artist})
        if not isinstance(results, list):
            message = "LRCLIB's search answered no list."
            raise _InvalidError(message)
        for each in results:
            record = _record(each)
            if _matches(record, title, artist, seconds):
                return record
        return None

    def _json(self, url: str, params: Mapping[str, str]) -> object | None:
        for attempt in range(1, MAX_ATTEMPTS + 1):
            self._pace()
            try:
                response = self._session.get(url, params=dict(params), timeout=TIMEOUT)
            except requests.RequestException as error:
                message = f"LRCLIB couldn't be reached: {type(error).__name__}."
                raise NetworkError(message) from error
            status = response.status_code
            if status in {HTTPStatus.TOO_MANY_REQUESTS, HTTPStatus.SERVICE_UNAVAILABLE}:
                self._wait_out(response, attempt)
                continue
            return _answer(response)
        message = "LRCLIB was too busy to answer."
        raise NetworkError(message)

    def _wait_out(self, response: requests.Response, attempt: int) -> None:
        wait = _retry_after(response)
        if wait > MAX_WAIT or attempt == MAX_ATTEMPTS:
            message = "LRCLIB was too busy to answer."
            raise NetworkError(message)
        self._sleep(wait + secrets.SystemRandom().uniform(0, wait * JITTER))

    def _pace(self) -> None:
        now = self._clock()
        if now < self._next_at:
            self._sleep(self._next_at - now)
            now = self._next_at
        self._next_at = now + SPACING


def _answer(response: requests.Response) -> object | None:
    """Return the JSON a response holds, `None` for nothing found, raising for a failure."""
    status = response.status_code
    if status == HTTPStatus.NOT_FOUND:
        return None
    if status == HTTPStatus.FORBIDDEN:
        message = "LRCLIB refused the request (HTTP 403)."
        raise _RefusedError(message)
    if status >= HTTPStatus.INTERNAL_SERVER_ERROR:
        message = f"LRCLIB failed to answer (HTTP {status})."
        raise NetworkError(message)
    if status != HTTPStatus.OK:
        message = f"LRCLIB couldn't use the request (HTTP {status})."
        raise _InvalidError(message)
    try:
        found: object = response.json()
    except ValueError as error:
        message = "LRCLIB answered something other than JSON."
        raise _InvalidError(message) from error
    return found


def _record(found: object) -> _Record:
    try:
        return _Record.model_validate(found)
    except ValidationError as error:
        message = "LRCLIB answered a record of another shape."
        raise _InvalidError(message) from error


def _matches(record: _Record, title: str, artist: str, seconds: float | None) -> bool:
    """Return whether a search result is the song: as long, or, length unknown, as named."""
    if seconds is not None:
        return record.duration is not None and abs(record.duration - seconds) <= MATCH_WITHIN
    return (record.trackName.casefold(), record.artistName.casefold()) == (
        title.casefold(),
        artist.casefold(),
    )


def _lyrics_of(record: _Record) -> FoundLyrics | None:
    """Return the record's lyrics, timed first, or that the song is instrumental."""
    if record.instrumental:
        return FoundLyrics(provider=LyricsProvider.LRCLIB, instrumental=True)
    for text in (record.syncedLyrics, record.plainLyrics):
        if text and text.strip() and len(text) <= MAX_LYRICS:
            return FoundLyrics(provider=LyricsProvider.LRCLIB, text=text)
    return None


def _option_of(record: _Record) -> LyricsOption | None:
    """Return the record as a song offered, or `None` when it has no title or no lyrics."""
    lyrics = _lyrics_of(record)
    if lyrics is None or not record.trackName.strip():
        return None
    return LyricsOption(
        provider=LyricsProvider.LRCLIB,
        title=record.trackName.strip()[:MAX_NAME],
        artist=record.artistName.strip()[:MAX_NAME],
        album=record.albumName.strip()[:MAX_NAME],
        duration_ms=None if record.duration is None else round(record.duration * 1000),
        text=lyrics.text,
        instrumental=lyrics.instrumental,
    )


def closest_first(options: list[LyricsOption], duration_ms: int | None) -> list[LyricsOption]:
    """Return `options` the closest in length to `duration_ms` first, else as found.

    A song of no known length comes after those whose length is known.
    """
    if duration_ms is None:
        return options
    return sorted(
        options,
        key=lambda each: (
            each.duration_ms is None,
            abs((each.duration_ms or 0) - duration_ms),
        ),
    )


def _retry_after(response: requests.Response) -> float:
    try:
        return float(response.headers.get("Retry-After", DEFAULT_WAIT))
    except ValueError:
        return DEFAULT_WAIT
