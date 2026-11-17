"""NetEase Cloud Music, asked for a song's lyrics when LRCLIB has none.

NetEase offers no public API, so only its two plain endpoints are used: a search by
title and artist, then the lyrics of the song found, by its id. Nothing copies the
signing or encryption its own apps use, and no header pretends to be a browser. A
refusal stops the enricher rather than being worked around, and a busy answer fails
the lookup without asking again.

A search result is the song when its title is the song's, compared without case or
width, and it is within two seconds of the song's length, or, its length unknown,
when one of its artists is the song's. A translation NetEase holds follows the
lyrics, each line at the time of the line it translates, as LRC writes one.
"""

import time
import unicodedata
from collections.abc import Callable, Mapping
from http import HTTPStatus
from typing import Final

import requests
from pydantic import BaseModel, ConfigDict, ValidationError

from medleyplay.plugin_api import (
    MAX_LYRICS,
    Enriched,
    EnrichStatus,
    EnrichTrack,
    FoundLyrics,
    LyricsProvider,
    NetworkError,
)
from medleyplay.plugins.lyrics.lrclib import USER_AGENT

API: Final = "https://music.163.com/api"
SEARCH: Final = f"{API}/search/get"
LYRIC: Final = f"{API}/song/lyric"
SPACING: Final = 1.0
"""The least time, in seconds, between two requests."""
TIMEOUT: Final = 10.0
RESULTS: Final = 10
"""How many search results are read for the song."""
MATCH_WITHIN_MS: Final = 2_000
"""How many milliseconds a result's length may differ from the song's."""
REFUSED_CODES: Final = frozenset({-460, -462})
"""The codes NetEase answers a request it won't serve, such as one it takes for a bot."""
BUSY_CODES: Final = frozenset({405, -447})
"""The codes NetEase answers when it is asked too often."""
PURE_MUSIC: Final = "纯音乐，请欣赏"  # noqa: RUF001 -- NetEase's own words
"""What NetEase writes as the only line of a song with no words."""

type Sleep = Callable[[float], None]
type Clock = Callable[[], float]


class _Model(BaseModel):
    model_config = ConfigDict(extra="ignore")


class _Named(_Model):
    name: str = ""


class _Song(_Model):
    """A song as NetEase's search lists it; `duration` is in milliseconds."""

    id: int
    name: str = ""
    artists: list[_Named] = []
    duration: int | None = None


class _Result(_Model):
    songs: list[_Song] = []


class _Search(_Model):
    result: _Result = _Result()


class _Text(_Model):
    lyric: str | None = None


class _Lyric(_Model):
    lrc: _Text = _Text()
    tlyric: _Text = _Text()
    nolyric: bool = False
    pureMusic: bool = False  # noqa: N815 -- NetEase's own name


class _RefusedError(Exception):
    """NetEase refused the request, so nothing more should be asked of it."""


class _InvalidError(Exception):
    """NetEase answered something that can't be used."""


class Netease:
    """Finds a song's lyrics on NetEase Cloud Music."""

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
        """Answer the song's lyrics, none when NetEase has none, or why NetEase said no."""
        shown = {each.field: str(each.value).strip() for each in request.shown}
        title, artist = shown.get("title", ""), shown.get("artist", "")
        if not title or not artist or request.whole_album:
            return Enriched()
        try:
            song = self._find(title, artist, request.duration_ms)
            lyrics = None if song is None else self._lyrics(song)
        except _RefusedError as error:
            return Enriched(status=EnrichStatus.REFUSED, message=str(error))
        except _InvalidError as error:
            return Enriched(status=EnrichStatus.INVALID, message=str(error))
        return Enriched(lyrics=lyrics)

    def _find(self, title: str, artist: str, duration_ms: int | None) -> _Song | None:
        found = self._json(SEARCH, {"s": f"{title} {artist}", "type": "1", "limit": str(RESULTS)})
        try:
            songs = _Search.model_validate(found).result.songs
        except ValidationError as error:
            message = "NetEase's search answered a list of another shape."
            raise _InvalidError(message) from error
        return next((each for each in songs if _matches(each, title, artist, duration_ms)), None)

    def _lyrics(self, song: _Song) -> FoundLyrics | None:
        found = self._json(LYRIC, {"id": str(song.id), "lv": "-1", "tv": "-1"})
        try:
            answer = _Lyric.model_validate(found)
        except ValidationError as error:
            message = "NetEase answered lyrics of another shape."
            raise _InvalidError(message) from error
        return _lyrics_of(answer)

    def _json(self, url: str, params: Mapping[str, str]) -> object:
        self._pace()
        try:
            response = self._session.get(url, params=dict(params), timeout=TIMEOUT)
        except requests.RequestException as error:
            message = f"NetEase couldn't be reached: {type(error).__name__}."
            raise NetworkError(message) from error
        return _answer(response)

    def _pace(self) -> None:
        now = self._clock()
        if now < self._next_at:
            self._sleep(self._next_at - now)
            now = self._next_at
        self._next_at = now + SPACING


def _answer(response: requests.Response) -> object:
    """Return the JSON a response holds, raising for a refusal, a busy site, or a failure."""
    status = response.status_code
    if status == HTTPStatus.FORBIDDEN:
        message = "NetEase refused the request (HTTP 403)."
        raise _RefusedError(message)
    if status in {HTTPStatus.TOO_MANY_REQUESTS, HTTPStatus.SERVICE_UNAVAILABLE}:
        message = "NetEase was too busy to answer."
        raise NetworkError(message)
    if status >= HTTPStatus.INTERNAL_SERVER_ERROR:
        message = f"NetEase failed to answer (HTTP {status})."
        raise NetworkError(message)
    if status != HTTPStatus.OK:
        message = f"NetEase couldn't use the request (HTTP {status})."
        raise _InvalidError(message)
    try:
        found: object = response.json()
    except ValueError as error:
        message = "NetEase answered something other than JSON."
        raise _InvalidError(message) from error
    code = found.get("code") if isinstance(found, dict) else None
    if code in REFUSED_CODES:
        message = f"NetEase refused the request (code {code})."
        raise _RefusedError(message)
    if code in BUSY_CODES:
        message = "NetEase was too busy to answer."
        raise NetworkError(message)
    if code != HTTPStatus.OK:
        message = f"NetEase couldn't use the request (code {code})."
        raise _InvalidError(message)
    return found


def _plain(text: str) -> str:
    """Return `text` as compared: without case, width, or extra spaces."""
    return " ".join(unicodedata.normalize("NFKC", text).casefold().split())


def _matches(song: _Song, title: str, artist: str, duration_ms: int | None) -> bool:
    """Return whether a search result is the song: as titled, and as long or by its artist."""
    if _plain(song.name) != _plain(title):
        return False
    if duration_ms is not None:
        return song.duration is not None and abs(song.duration - duration_ms) <= MATCH_WITHIN_MS
    return any(_plain(each.name) == _plain(artist) for each in song.artists)


def _lyrics_of(answer: _Lyric) -> FoundLyrics | None:
    """Return the lyrics, their translation after them, or that the song is instrumental."""
    text = answer.lrc.lyric or ""
    if answer.nolyric or answer.pureMusic or _is_pure_music(text):
        return FoundLyrics(provider=LyricsProvider.NETEASE, instrumental=True)
    if not text.strip() or len(text) > MAX_LYRICS:
        return None
    translation = (answer.tlyric.lyric or "").strip()
    with_translation = f"{text.rstrip()}\n{translation}\n" if translation else text
    if len(with_translation) <= MAX_LYRICS:
        text = with_translation
    return FoundLyrics(provider=LyricsProvider.NETEASE, text=text)


def _is_pure_music(text: str) -> bool:
    """Return whether the lyrics are NetEase's one line for a song with no words."""
    words = [line.rpartition("]")[2].strip() for line in text.splitlines() if line.strip()]
    return words == [PURE_MUSIC]
