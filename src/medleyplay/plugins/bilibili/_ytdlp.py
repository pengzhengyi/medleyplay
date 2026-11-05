"""Every call to yt-dlp, which has no type hints, returning plain values and sorted failures.

yt-dlp only ever sees a URL this plugin built, and only its Bilibili extractor
may run, so its generic extractor never fetches anything else. It keeps no cache
and writes nothing but the download.

The household's proxy comes with each call, and nothing else decides the path: with
a proxy yt-dlp uses it for every host, ignoring the environment, the system's
settings, and every bypass list; with none it goes direct, ignoring them all too.
The request handler that does so is below.

Unverified until yt-dlp can read Bilibili again: the options and the errors
follow yt-dlp's documentation and source, not a run against the site.
"""

import base64
import re
import urllib.error
import urllib.request
from collections.abc import Callable, Mapping
from typing import Any, Final
from urllib.parse import unquote, urlsplit

import yt_dlp  # type: ignore[import-untyped] # yt-dlp ships no type hints
from yt_dlp.networking import (  # type: ignore[import-untyped]
    Request,
    RequestDirector,
    _urllib,
)
from yt_dlp.networking.exceptions import (  # type: ignore[import-untyped]
    HTTPError,
    NoSupportingHandlers,
    RequestError,
    TransportError,
)
from yt_dlp.utils import (  # type: ignore[import-untyped]
    DownloadError,
    ExtractorError,
    GeoRestrictedError,
)

from medleyplay.plugin_api import AuthError, NetworkError

type Info = Mapping[str, object]
type OnProgress = Callable[[int, int | None], None]
"""Bytes downloaded so far, and the total when known."""

SOCKET_TIMEOUT_SECONDS: Final = 4
"""Below the plugin API's deadlines, so a stalled read fails as a network failure first."""
OUTPUT_NAME: Final = "audio.%(ext)s"

_LOGIN: Final = re.compile(r"registered users|log ?in|sign ?in", re.IGNORECASE)
_MEMBERS: Final = re.compile(r"premium members|supporter-only|members only|purchase", re.IGNORECASE)
_REFUSED: Final = re.compile(r"rate limit|blocked by server|rejected by server", re.IGNORECASE)
# The site's risk control answers a request from a client it suspects with 352, 401, or 412.
_RISK_CONTROL: Final = re.compile(r"Unable to download video info: (?:352|401|412)\b")
_REFUSED_STATUSES: Final = frozenset({403, 412})
_REMOVED: Final = re.compile(r"deleted or geo-restricted", re.IGNORECASE)
_RETRY_LATER: Final = frozenset({429, 500, 502, 503, 504})
_GONE: Final = frozenset({404, 410})
_REDIRECTS: Final = frozenset({301, 302, 303, 307, 308})
_SOCKS: Final = "socks5h"


class GoneError(Exception):
    """The site says the video isn't there for anyone: removed or region-locked."""


class NeedsLoginError(Exception):
    """The site shows the video only to a signed-in account, and none was sent."""


class RefusedError(RuntimeError):
    """The site refused the request: a 403, a 412, a rate limit, or its risk control."""


def extract(
    url: str, *, playlist: bool, cookie_file: str | None = None, proxy: str | None = None
) -> Info:
    """Read the info yt-dlp extracts from `url`, without downloading.

    With `playlist`, a video with several parts comes back as a playlist whose
    entries are only the parts' URLs. Every request goes through `proxy`, or direct
    when there is none.
    """
    options = {
        **_base(cookie_file, proxy),
        "skip_download": True,
        "noplaylist": not playlist,
        "extract_flat": "in_playlist",
    }
    return _run(options, lambda ydl: _extract(ydl, url, download=False), cookie_file)


def extract_with_image(
    url: str,
    *,
    proxy: str | None,
    image_of: Callable[[Info], str | None],
    max_bytes: int,
) -> tuple[Info, bytes | None]:
    """Read the info of the single video at `url`, and the image `image_of` names in it.

    The image is fetched with the same request handler as the page, so it goes
    through `proxy` too, or direct when there is none. An image that can't be
    fetched, or is longer than `max_bytes`, is `None`; the info still comes back.
    A video's formats aren't needed, so a video with none is read all the same.
    """
    options = {
        **_base(None, proxy),
        "skip_download": True,
        "noplaylist": True,
        "ignore_no_formats_error": True,
    }

    def read(ydl: Any) -> tuple[Info, bytes | None]:  # noqa: ANN401 -- yt-dlp has no type hints
        info = _extract(ydl, url, download=False)
        image_url = image_of(info)
        return info, None if image_url is None else _fetch(ydl, image_url, max_bytes)

    return _run(options, read, None)


def _fetch(ydl: Any, url: str, max_bytes: int) -> bytes | None:  # noqa: ANN401 -- as above
    try:
        with ydl.urlopen(Request(url)) as response:
            data: bytes = response.read(max_bytes + 1)
    except RequestError:
        return None
    return data if len(data) <= max_bytes else None


def download(
    url: str,
    *,
    formats: str,
    folder: str,
    cookie_file: str | None,
    on_progress: OnProgress,
    proxy: str | None = None,
) -> Info:
    """Download the first of `formats` the site offers into `folder`, as `audio.<ext>`.

    Every request goes through `proxy`, or direct when there is none.
    """

    def hook(status: Mapping[str, Any]) -> None:
        if status.get("status") == "downloading":
            total = status.get("total_bytes") or status.get("total_bytes_estimate")
            on_progress(int(status.get("downloaded_bytes") or 0), int(total) if total else None)

    options = {
        **_base(cookie_file, proxy),
        "noplaylist": True,
        "format": formats,
        "paths": {"home": folder, "temp": folder},
        "outtmpl": {"default": OUTPUT_NAME},
        "overwrites": True,
        "progress_hooks": [hook],
        "postprocessors": [],
    }
    return _run(options, lambda ydl: _extract(ydl, url, download=True), cookie_file)


def _extract(ydl: Any, url: str, *, download: bool) -> Info:  # noqa: ANN401 -- as above
    info = ydl.extract_info(url, download=download)
    if not isinstance(info, Mapping):  # pragma: no cover -- yt-dlp returns a dict or raises
        message = f"yt-dlp returned {type(info).__name__}, not its info."
        raise TypeError(message)
    return info


def _base(cookie_file: str | None, proxy: str | None) -> dict[str, object]:
    return {
        "allowed_extractors": ["bilibili"],
        "socket_timeout": SOCKET_TIMEOUT_SECONDS,
        # An empty proxy is yt-dlp's "none", and a missing one would read the environment.
        "proxy": proxy or "",
        "cachedir": False,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "color": "never",
        "logger": _Quiet(),
        "retries": 1,
        "cookiefile": cookie_file,
    }


def _run[T](options: dict[str, object], call: Callable[[Any], T], cookie_file: str | None) -> T:
    try:
        with _YoutubeDL(options) as ydl:
            return call(ydl)
    except DownloadError as error:
        cause = (error.exc_info[1] if error.exc_info else None) or error
        refusal = refusal_of(cause)
        if refusal is not None:
            raise RefusedError(refusal) from None
        raise sort_failure(cause, signed_in=cookie_file is not None) from None


def sort_failure(error: BaseException, *, signed_in: bool) -> Exception:
    """Return the failure the plugin raises for one of yt-dlp's errors.

    By type first: a connection failure or a timeout, a 429, or a 5xx is a
    `NetworkError`; a 404, a 410, or a geo-restriction is gone; a 403 or a 412 is
    Bilibili refusing the client, a fault, so it isn't retried every minute. An
    error yt-dlp marks *expected* is sorted by yt-dlp's own fixed messages: a
    login refused, a video for members, a rate limit, or a removal.

    Anything else is a fault, such as an extractor that no longer understands
    the page or a message it doesn't recognize: a fault is retried and shows, while
    gone makes the Source unavailable for good. A video for members never marks a
    login refused, since the account may simply not be a member.
    """
    # yt-dlp hands over the network error itself when an extractor raised it, and
    # wrapped in an `ExtractorError` when it raised its own.
    for cause in (error, getattr(error, "cause", None)):
        if isinstance(cause, HTTPError):
            return _sort_status(cause.status)
        if isinstance(cause, TransportError):
            return NetworkError(f"Bilibili couldn't be reached: {cause}")
    if isinstance(error, GeoRestrictedError):
        return GoneError(f"Bilibili doesn't offer the video here: {error}")
    if isinstance(error, ExtractorError) and error.expected:
        return _sort_expected(str(getattr(error, "orig_msg", None) or error), signed_in=signed_in)
    return RuntimeError(f"yt-dlp failed: {error}")


def refusal_of(error: BaseException) -> str | None:
    """Return the message for `error` when it is the site refusing the request, else `None`.

    A 403 or 412 from the site, its rate limit, or the codes of its risk control
    (352, 401, 412) in the error yt-dlp reports.
    """
    for cause in (error, getattr(error, "cause", None)):
        if isinstance(cause, HTTPError) and cause.status in _REFUSED_STATUSES:
            return f"Bilibili refused the request ({cause.status})."
    if isinstance(error, ExtractorError):
        text = str(getattr(error, "orig_msg", None) or error)
        if _RISK_CONTROL.search(text) or (error.expected and _REFUSED.search(text)):
            return f"Bilibili refused the request: {text}"
    return None


def _sort_status(status: int) -> Exception:
    if status in _RETRY_LATER:
        return NetworkError(f"Bilibili answered {status}; trying again later.")
    if status in _GONE:
        return GoneError("Bilibili has no such video.")
    return RuntimeError(f"Bilibili refused the request ({status}).")


def _sort_expected(text: str, *, signed_in: bool) -> Exception:
    if _REFUSED.search(text):
        return RuntimeError(f"Bilibili refused the request: {text}")
    if _LOGIN.search(text):
        return AuthError(text) if signed_in else NeedsLoginError(text)
    if _MEMBERS.search(text) and not signed_in:
        return NeedsLoginError(text)
    if _REMOVED.search(text):
        return GoneError(text)
    return RuntimeError(f"yt-dlp failed: {text}")


class _Quiet:
    """A logger that keeps yt-dlp silent; its failures arrive as exceptions instead."""

    def debug(self, _: str) -> None: ...
    def info(self, _: str) -> None: ...
    def warning(self, _: str) -> None: ...
    def error(self, _: str) -> None: ...
    def stdout(self, _: str) -> None: ...
    def stderr(self, _: str) -> None: ...


def read_redirect(url: str, *, proxy: str | None, timeout: float, user_agent: str) -> str | None:
    """Ask for `url` once and return where it redirects to, or `None` when it doesn't.

    No redirect is followed and no cookie is sent or kept; nothing of the body is
    read. The request goes through `proxy`, or direct when there is none. A
    connection that fails, or an answer that isn't a redirect, raises `NetworkError`.
    """
    quiet = _Quiet()
    director = RequestDirector(logger=quiet)
    director.add_handler(
        _OneHopRH(
            logger=quiet,
            timeout=timeout,
            proxies={"all": proxy},
            headers={"User-Agent": user_agent},
        )
    )
    host = urlsplit(url).netloc
    try:
        director.send(Request(url)).close()
    except HTTPError as error:
        with error.response:
            if error.status in _REDIRECTS:
                location: str | None = error.response.headers.get("Location")
                return location
        message = f"{host} answered {error.status}."
        raise NetworkError(message) from None
    except NoSupportingHandlers:
        message = "A short link can't be followed through that kind of proxy; use http or socks5h."
        raise RuntimeError(message) from None
    except RequestError as error:
        message = f"{host} couldn't be reached: {error}"
        raise NetworkError(message) from None
    return None


class _Proxy(urllib.request.BaseHandler):
    """Sends every request through the one proxy it was given, whatever a bypass list says.

    urllib's own proxy handler asks the environment and the system whether to skip
    the proxy for a host, and goes direct when they say so.
    """

    handler_order = 100

    def __init__(self, proxies: Mapping[str, str | None]) -> None:
        self._proxy = proxies.get("all")

    def http_open(self, request: urllib.request.Request) -> None:
        self._through(request)

    def https_open(self, request: urllib.request.Request) -> None:
        self._through(request)

    def _through(self, request: urllib.request.Request) -> None:
        if self._proxy is None:
            return
        proxy = urlsplit(self._proxy)
        if proxy.scheme == _SOCKS:
            # yt-dlp's HTTP handler reads this header and wraps the socket.
            request.add_header("Ytdl-socks-proxy", self._proxy)
            return
        if proxy.username is not None:
            login = f"{unquote(proxy.username)}:{unquote(proxy.password or '')}"
            token = base64.b64encode(login.encode()).decode("ascii")
            request.add_header("Proxy-authorization", f"Basic {token}")
        host = f"[{proxy.hostname}]" if ":" in (proxy.hostname or "") else proxy.hostname
        request.set_proxy(f"{host}:{proxy.port}", "http")


class _NoRedirect(urllib.request.BaseHandler):
    """Answers a redirect as an error, so the caller reads it instead of following it."""

    handler_order = 100

    def http_error_301(
        self,
        request: urllib.request.Request,
        response: object,
        code: int,
        message: str,
        headers: object,
    ) -> None:
        raise urllib.error.HTTPError(request.full_url, code, message, headers, response)  # type: ignore[arg-type] # urllib's own types

    http_error_302 = http_error_303 = http_error_307 = http_error_308 = http_error_301


class _ProxiedRH(_urllib.UrllibRH):  # type: ignore[misc] # yt-dlp ships no type hints
    """yt-dlp's urllib request handler, with the proxy used for every host and no other.

    An `https` proxy is not one urllib can use; yt-dlp then falls back to its other
    handler for requests, when it has one.
    """

    def _create_instance(
        self,
        proxies: Mapping[str, str | None],
        cookiejar: object,
        legacy_ssl_support: object = None,
    ) -> urllib.request.OpenerDirector:
        # yt-dlp's own proxy handler gets none, so only ours decides.
        opener: urllib.request.OpenerDirector = super()._create_instance(
            {}, cookiejar, legacy_ssl_support
        )
        opener.add_handler(_Proxy(proxies))
        return opener


class _OneHopRH(_ProxiedRH):
    """The same, answering a redirect as an error instead of following it."""

    def _create_instance(
        self,
        proxies: Mapping[str, str | None],
        cookiejar: object,
        legacy_ssl_support: object = None,
    ) -> urllib.request.OpenerDirector:
        opener = super()._create_instance(proxies, cookiejar, legacy_ssl_support)
        opener.add_handler(_NoRedirect())
        return opener


class _YoutubeDL(yt_dlp.YoutubeDL):  # type: ignore[misc] # yt-dlp ships no type hints
    """yt-dlp that sends its requests with `_ProxiedRH` before any other handler."""

    def build_request_director(
        self, handlers: object, preferences: object = None
    ) -> RequestDirector:
        director: RequestDirector = super().build_request_director(
            [*handlers, _ProxiedRH],  # type: ignore[misc] # yt-dlp's list of handler classes
            preferences,
        )
        director.preferences.add(lambda handler, _: 1000 if isinstance(handler, _ProxiedRH) else 0)
        return director
