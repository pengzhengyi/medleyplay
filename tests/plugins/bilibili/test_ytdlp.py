"""yt-dlp's failures are sorted by type, and it never runs on a URL it wasn't meant for."""

import gc
import io
from collections.abc import Callable, Iterator, Mapping
from pathlib import Path
from typing import Protocol, Self
from urllib.error import URLError
from urllib.parse import urlsplit

import pytest
import yt_dlp  # type: ignore[import-untyped]
from yt_dlp.extractor.bilibili import BiliBiliIE  # type: ignore[import-untyped]
from yt_dlp.networking import Response  # type: ignore[import-untyped]
from yt_dlp.networking.common import _REQUEST_HANDLERS  # type: ignore[import-untyped]
from yt_dlp.networking.exceptions import (  # type: ignore[import-untyped]
    HTTPError,
    ProxyError,
    TransportError,
)
from yt_dlp.utils import ExtractorError, GeoRestrictedError  # type: ignore[import-untyped]

from medleyplay.plugin_api import AuthError, NetworkError
from medleyplay.plugins.bilibili import _ytdlp
from medleyplay.plugins.bilibili._ytdlp import (
    BoundedDownloadError,
    GoneError,
    NeedsLoginError,
    RefusedError,
    download,
    extract,
    extract_with_image,
    refusal_of,
    sort_failure,
)
from medleyplay.programs.joined_audio import file_limit
from tests.support.images import jpeg_image, oversized_jpeg
from tests.support.proxies import Answer, running_http_proxy, running_socks_proxy
from tests.support.recordings import recorded_info


def _http(status: int) -> ExtractorError:
    """An extractor error caused by the site answering `status`."""
    response = Response(io.BytesIO(), "https://www.bilibili.com/video/BV1Xx41117Tz", {}, status)
    return ExtractorError("Unable to download webpage", cause=HTTPError(response))


@pytest.mark.parametrize("status", [500, 503])
def test_a_busy_or_failing_site_is_a_network_failure(status: int) -> None:
    failure = sort_failure(_http(status), signed_in=False)

    assert isinstance(failure, NetworkError)
    assert failure.http_status == status


def test_a_connection_that_fails_is_a_network_failure() -> None:
    error = ExtractorError("Unable to download webpage", cause=TransportError("timed out"))

    assert isinstance(sort_failure(error, signed_in=False), NetworkError)


@pytest.mark.parametrize(
    "error",
    [
        TransportError("timed out"),
        ProxyError(cause=URLError(OSError("Tunnel connection failed: 403 Forbidden"))),
    ],
    ids=["a connection error", "a proxy that refuses the tunnel"],
)
def test_a_network_error_raised_by_yt_dlp_itself_is_a_network_failure(error: Exception) -> None:
    assert isinstance(sort_failure(error, signed_in=False), NetworkError)


def test_a_status_error_raised_by_yt_dlp_itself_is_sorted_by_its_status() -> None:
    response = Response(io.BytesIO(), "https://www.bilibili.com/video/BV1Xx41117Tz", {}, 404)

    assert isinstance(sort_failure(HTTPError(response), signed_in=False), GoneError)


def test_a_missing_page_is_gone() -> None:
    assert isinstance(sort_failure(_http(404), signed_in=False), GoneError)


@pytest.mark.parametrize(
    ("status", "reason"),
    [
        (403, "provider_refused"),
        (412, "provider_refused"),
        (429, "provider_refused"),
        (567, "response_unknown"),
    ],
)
def test_a_wrapped_stop_status_is_not_a_retryable_network_failure(status: int, reason: str) -> None:
    failure = sort_failure(_http(status), signed_in=True)

    assert isinstance(failure, RefusedError)
    assert (failure.status, failure.reason) == (status, reason)
    assert str(status) in str(failure)


@pytest.mark.parametrize(
    "message",
    ["This video is only available for registered users", "Please log in to watch this video"],
)
def test_an_expected_login_refusal_needs_a_login_or_fails_the_one_sent(message: str) -> None:
    error = ExtractorError(message, expected=True)

    assert isinstance(sort_failure(error, signed_in=False), NeedsLoginError)
    assert isinstance(sort_failure(error, signed_in=True), AuthError)


@pytest.mark.parametrize(
    "message",
    ["This video is for premium members only", "This is a supporter-only video: x"],
)
def test_a_video_for_members_needs_a_login_but_never_refuses_the_one_sent(message: str) -> None:
    error = ExtractorError(message, expected=True)

    assert isinstance(sort_failure(error, signed_in=False), NeedsLoginError)
    assert type(sort_failure(error, signed_in=True)) is RuntimeError


def test_an_expected_rate_limit_stops_without_exposing_provider_text() -> None:
    error = ExtractorError("You have exceeded the rate limit. Try again later", expected=True)

    failure = sort_failure(error, signed_in=True)

    assert isinstance(failure, RefusedError)
    assert str(failure) == "Bilibili refused the request."


def test_a_successful_http_response_with_a_refusal_code_is_the_last_request(
    no_outside_network: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    page = "/video/BV17x411w7KC"
    play = "/x/player/wbi/playurl"
    replies = {
        page: b"""
            <script>window.__INITIAL_STATE__={"videoData":{
                "bvid":"BV17x411w7KC","aid":170001,"cid":1,"title":"Fixture"
            }};</script>
        """,
        "/x/player/pagelist": b'{"data":[]}',
        play: b'{"code":-352,"message":"synthetic refusal"}',
        "/x/player/wbi/v2": b'{"data":{}}',
    }
    seen: list[str] = []

    def reply(_ydl: object, request: _UrlRequest) -> Response:
        path = urlsplit(request.url).path
        seen.append(path)
        return Response(io.BytesIO(replies[path]), request.url, {}, 200)

    monkeypatch.setattr(yt_dlp.YoutubeDL, "urlopen", reply)
    monkeypatch.setattr(BiliBiliIE, "_sign_wbi", lambda _, params, _video: params)

    with pytest.raises(RefusedError, match=r"\b352\b") as stopped:
        extract(f"https://www.bilibili.com{page}", playlist=False)

    assert stopped.value.reason == "provider_refused"
    assert seen == [page, "/x/player/pagelist", play]


class _UrlRequest(Protocol):
    @property
    def url(self) -> str: ...


@pytest.mark.parametrize(
    "error",
    [
        ExtractorError("This video may be deleted or geo-restricted.", expected=True),
        GeoRestrictedError("This video is not available from your location"),
    ],
)
def test_an_expected_removal_is_gone(error: ExtractorError) -> None:
    assert isinstance(sort_failure(error, signed_in=False), GoneError)


def test_an_expected_error_it_does_not_recognize_is_a_fault_not_gone() -> None:
    # A Source that is gone stays unavailable, so only a sure removal is gone.
    error = ExtractorError("视频不见了", expected=True)

    failure = sort_failure(error, signed_in=False)

    assert type(failure) is RuntimeError
    assert "视频不见了" in str(failure)


def test_an_extractor_that_no_longer_understands_the_page_is_a_fault() -> None:
    failure = sort_failure(ExtractorError("Unable to extract initial state"), signed_in=False)

    assert type(failure) is RuntimeError
    assert "initial state" in str(failure)


def test_yt_dlp_refuses_a_url_the_bilibili_extractor_does_not_handle_without_fetching_it() -> None:
    # example.invalid can't resolve, so a fetch would fail as a network failure.
    with pytest.raises(RuntimeError, match="No suitable extractor"):
        extract("https://example.invalid/video/1", playlist=False)


VIDEO_PAGE = "www.bilibili.com/video/BV1Xx41117Tz"


@pytest.fixture
def collected() -> Iterator[None]:
    """Collect garbage after the test, while its warning filters still apply."""
    yield
    gc.collect()


def refused_answers_are_left_to_the_collector[T: Callable[..., object]](test: T) -> T:
    """Mark a test whose refusal leaves yt-dlp's open answer to be closed by the collector."""
    ignored = pytest.mark.filterwarnings("ignore::pytest.PytestUnraisableExceptionWarning")
    marked: T = pytest.mark.usefixtures("collected")(test)
    return ignored(marked)  # type: ignore[no-any-return] # pytest's mark decorators are untyped


def _environment_names(monkeypatch: pytest.MonkeyPatch, proxy: str) -> None:
    """Make the environment name `proxy` as every proxy variable a tool might read."""
    for name in (
        "http_proxy",
        "HTTP_PROXY",
        "https_proxy",
        "HTTPS_PROXY",
        "all_proxy",
        "ALL_PROXY",
    ):
        monkeypatch.setenv(name, proxy)


def test_without_a_proxy_yt_dlp_goes_direct_even_when_the_environment_names_one(
    no_outside_network: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    with running_http_proxy() as environment_proxy:
        _environment_names(monkeypatch, environment_proxy.url)

        # Direct, the name can't be looked up: the guard stands in for the site.
        with pytest.raises(NetworkError):
            extract(f"http://{VIDEO_PAGE}", playlist=False)

    assert environment_proxy.requests == []


@pytest.mark.parametrize("proxy", [None, ""])
def test_a_download_without_a_proxy_goes_direct_even_when_the_environment_names_one(
    no_outside_network: None, monkeypatch: pytest.MonkeyPatch, tmp_path: Path, proxy: str | None
) -> None:
    with running_http_proxy() as environment_proxy:
        _environment_names(monkeypatch, environment_proxy.url)

        with pytest.raises(NetworkError):
            download(
                f"http://{VIDEO_PAGE}",
                formats="30280",
                folder=str(tmp_path),
                cookie_file=None,
                on_progress=lambda *_: None,
                proxy=proxy,
            )

    assert environment_proxy.requests == []


@refused_answers_are_left_to_the_collector
def test_with_a_proxy_every_request_goes_through_it_over_the_environment_and_the_bypass_list(
    no_outside_network: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    with running_http_proxy() as household, running_http_proxy() as environment_proxy:
        _environment_names(monkeypatch, environment_proxy.url)
        monkeypatch.setenv("no_proxy", "www.bilibili.com,b23.tv")
        monkeypatch.setenv("NO_PROXY", "www.bilibili.com,b23.tv")

        with pytest.raises(RuntimeError, match="refused the request"):
            extract(f"http://{VIDEO_PAGE}", playlist=False, proxy=household.url)

    assert [line.split()[:2] for line in household.requests] == [["GET", f"http://{VIDEO_PAGE}"]]
    assert environment_proxy.requests == []


@refused_answers_are_left_to_the_collector
def test_a_refusal_through_the_proxy_is_asked_once_and_not_tried_another_way(
    no_outside_network: None,
) -> None:
    with (
        running_http_proxy(otherwise=Answer(412)) as proxy,
        pytest.raises(RuntimeError, match=r"refused the request \(412\)"),
    ):
        extract(f"http://{VIDEO_PAGE}", playlist=False, proxy=proxy.url)

    assert len(proxy.requests) == 1


def test_a_secure_request_asks_the_proxy_for_a_tunnel_to_the_host(
    no_outside_network: None,
) -> None:
    with running_http_proxy() as proxy, pytest.raises(NetworkError):
        extract(f"https://{VIDEO_PAGE}", playlist=False, proxy=proxy.url)

    assert proxy.requests == ["CONNECT www.bilibili.com:443 HTTP/1.1"]


def test_an_https_proxy_has_a_request_handler_that_takes_it() -> None:
    # urllib takes no `https` proxy, so yt-dlp needs its `requests` handler for one.
    schemes = [
        handler._SUPPORTED_PROXY_SCHEMES  # noqa: SLF001 -- yt-dlp states them nowhere public
        for handler in _REQUEST_HANDLERS.values()
    ]

    assert any("https" in each for each in schemes)


def test_a_socks_proxy_is_asked_for_the_host_by_name(no_outside_network: None) -> None:
    with running_socks_proxy() as proxy, pytest.raises(NetworkError):
        extract(f"https://{VIDEO_PAGE}", playlist=False, proxy=proxy.url)

    assert proxy.asked == ["www.bilibili.com:443"]


@refused_answers_are_left_to_the_collector
def test_a_download_goes_through_the_proxy_it_is_given(
    no_outside_network: None, tmp_path: Path
) -> None:
    with running_http_proxy() as proxy, pytest.raises(RuntimeError, match="412"):
        download(
            f"http://{VIDEO_PAGE}",
            formats="30280",
            folder=str(tmp_path),
            cookie_file=None,
            on_progress=lambda *_: None,
            proxy=proxy.url,
        )

    assert len(proxy.requests) == 1


class _ProcessVideo(Protocol):
    def process_ie_result(self, info: dict[str, object], *, download: bool) -> object: ...


_MEDIA = "http://www.bilibili.com/test-audio"
_PART_CAP = 64 * 1024


def _synthetic_stream(monkeypatch: pytest.MonkeyPatch, protocol: str) -> None:
    def extract_stream(ydl: _ProcessVideo, _url: str, *, download: bool) -> _ytdlp.Info:
        info = ydl.process_ie_result(
            {
                "id": "test",
                "title": "Test audio",
                "url": _MEDIA,
                "ext": "m4a",
                "protocol": protocol,
                "format_id": "30280",
                "vcodec": "none",
                "acodec": "aac",
            },
            download=download,
        )
        assert isinstance(info, Mapping)
        return info

    monkeypatch.setattr(_ytdlp, "_extract", extract_stream)


@refused_answers_are_left_to_the_collector
@pytest.mark.parametrize("bounded_http", [False, True], ids=["separate", "joined"])
@pytest.mark.parametrize(
    ("status", "reason"),
    [
        (403, "provider_refused"),
        (412, "provider_refused"),
        (429, "provider_refused"),
        (567, "response_unknown"),
    ],
)
def test_a_rejected_media_request_stops_with_typed_evidence(
    no_outside_network: None,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    status: int,
    reason: str,
    *,
    bounded_http: bool,
) -> None:
    _synthetic_stream(monkeypatch, "http")

    with (
        running_http_proxy({_MEDIA: Answer(status)}) as proxy,
        pytest.raises(RefusedError, match=str(status)) as failure,
    ):
        download(
            f"http://{VIDEO_PAGE}",
            formats="30280",
            folder=str(tmp_path),
            cookie_file=None,
            on_progress=lambda *_: None,
            proxy=proxy.url,
            bounded_http=bounded_http,
        )

    assert proxy.requests == [f"GET {_MEDIA} HTTP/1.1"]
    assert failure.value.reason == reason
    assert failure.value.status == status
    assert failure.value.media
    assert list(tmp_path.iterdir()) == []


@refused_answers_are_left_to_the_collector
def test_a_media_server_unavailable_response_remains_retryable(
    no_outside_network: None, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _synthetic_stream(monkeypatch, "http")

    with (
        running_http_proxy({_MEDIA: Answer(503)}) as proxy,
        pytest.raises(NetworkError, match="503") as transient,
    ):
        download(
            f"http://{VIDEO_PAGE}",
            formats="30280",
            folder=str(tmp_path),
            cookie_file=None,
            on_progress=lambda *_: None,
            proxy=proxy.url,
        )

    assert transient.value.http_status == 503
    assert proxy.requests == [f"GET {_MEDIA} HTTP/1.1"]
    assert not (tmp_path / "audio.m4a").exists()


@pytest.mark.parametrize("size", [32 * 1024, 256 * 1024])
def test_native_http_enforces_the_write_limit_without_a_content_length(
    no_outside_network: None, monkeypatch: pytest.MonkeyPatch, tmp_path: Path, size: int
) -> None:
    _synthetic_stream(monkeypatch, "http")
    body = b"\x01" * size
    with running_http_proxy({_MEDIA: Answer(200, body=body, send_length=False)}) as proxy:

        def transfer() -> None:
            with file_limit(_PART_CAP):
                download(
                    f"http://{VIDEO_PAGE}",
                    formats="30280",
                    folder=str(tmp_path),
                    cookie_file=None,
                    on_progress=lambda *_: None,
                    proxy=proxy.url,
                    bounded_http=True,
                )

        if size <= _PART_CAP:
            transfer()
            assert (tmp_path / "audio.m4a").read_bytes() == body
        else:
            with pytest.raises(BoundedDownloadError, match="temporary download limit"):
                transfer()
            assert not (tmp_path / "audio.m4a").exists()
            assert (tmp_path / "audio.m4a.part").stat().st_size == _PART_CAP


def test_joined_download_refuses_fragmented_audio_before_downloading(
    no_outside_network: None, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _synthetic_stream(monkeypatch, "m3u8_native")
    with (
        running_http_proxy() as proxy,
        pytest.raises(BoundedDownloadError, match="Use Separate files"),
    ):
        download(
            f"http://{VIDEO_PAGE}",
            formats="30280",
            folder=str(tmp_path),
            cookie_file=None,
            on_progress=lambda *_: None,
            proxy=proxy.url,
            bounded_http=True,
        )

    assert proxy.requests == []
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize("status", [403, 412])
def test_a_403_or_412_from_the_site_is_a_refusal(status: int) -> None:
    assert refusal_of(_http(status)) == f"Bilibili refused the request ({status})."


@pytest.mark.parametrize(
    "message",
    [
        "You have exceeded the rate limit. Try again later",
        "Request is blocked by server (412), please wait and try later.",
        "Request is rejected by server (352)",
    ],
)
def test_an_expected_message_of_the_sites_defenses_is_a_refusal(message: str) -> None:
    assert refusal_of(ExtractorError(message, expected=True)) == (
        f"Bilibili refused the request: {message}"
    )


@pytest.mark.parametrize("code", [352, 401, 412])
def test_a_risk_control_code_in_the_error_is_a_refusal_expected_or_not(code: int) -> None:
    message = f"Unable to download video info: {code}: request intercepted"

    for expected in (True, False):
        assert refusal_of(ExtractorError(message, expected=expected)) is not None


@pytest.mark.parametrize(
    "error",
    [
        _http(404),
        _http(503),
        ExtractorError("This video may be deleted or geo-restricted.", expected=True),
        ExtractorError("Unable to download video info: 404: not found"),
        ExtractorError("Unable to extract initial state"),
        TransportError("timed out"),
    ],
    ids=["gone", "busy", "removed", "another code", "extractor failure", "connection"],
)
def test_an_error_that_is_not_the_sites_defenses_is_no_refusal(error: Exception) -> None:
    assert refusal_of(error) is None


@refused_answers_are_left_to_the_collector
def test_a_refusal_through_the_proxy_is_raised_as_a_refusal_that_is_still_a_runtime_error(
    no_outside_network: None,
) -> None:
    with running_http_proxy(otherwise=Answer(412)) as proxy, pytest.raises(RefusedError):
        extract(f"http://{VIDEO_PAGE}", playlist=False, proxy=proxy.url)

    assert issubclass(RefusedError, RuntimeError)


class _Ydl:
    """A stand-in for yt-dlp that keeps its options and answers the recorded video."""

    options: dict[str, object]

    def __init__(self, options: dict[str, object]) -> None:
        type(self).options = options

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def extract_info(self, url: str, *, download: bool) -> object:
        assert not download
        return recorded_info("BV1AC4y1L7Yi")

    def urlopen(self, request: object) -> io.BytesIO:
        return io.BytesIO(jpeg_image())


def test_reading_details_hands_the_proxy_to_yt_dlp_and_downloads_no_media(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(_ytdlp, "_YoutubeDL", _Ydl)

    extract_with_image(
        f"https://{VIDEO_PAGE}",
        proxy="socks5h://127.0.0.1:7890",
        image_of=lambda _: None,
        max_bytes=9,
    )

    assert _Ydl.options["proxy"] == "socks5h://127.0.0.1:7890"
    assert (_Ydl.options["skip_download"], _Ydl.options["noplaylist"]) == (True, True)
    assert _Ydl.options["allowed_extractors"] == ["bilibili"]


def test_reading_details_without_a_proxy_asks_yt_dlp_for_none(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(_ytdlp, "_YoutubeDL", _Ydl)

    extract_with_image(f"https://{VIDEO_PAGE}", proxy=None, image_of=lambda _: None, max_bytes=9)

    assert _Ydl.options["proxy"] == ""


COVER_URL = "http://i2.hdslb.com/bfs/archive/ffd2e726d214bc076f6eb9fdae103bd9d8ff7e73.jpg"


def _recorded_page(monkeypatch: pytest.MonkeyPatch) -> None:
    """Make yt-dlp's extraction of the page answer the recorded video, as the page would."""
    monkeypatch.setattr(_ytdlp, "_extract", lambda *_, **__: recorded_info("BV1AC4y1L7Yi"))


def _cover_url_of_the_recording(info: object) -> str:
    return COVER_URL


def test_the_thumbnail_is_fetched_through_the_proxy_over_the_environment_and_the_bypass_list(
    no_outside_network: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    _recorded_page(monkeypatch)
    thumbnail = jpeg_image("生如夏花")
    with (
        running_http_proxy({COVER_URL: Answer(200, body=thumbnail)}) as household,
        running_http_proxy() as environment_proxy,
    ):
        _environment_names(monkeypatch, environment_proxy.url)
        monkeypatch.setenv("no_proxy", "i2.hdslb.com")

        info, image = extract_with_image(
            f"http://{VIDEO_PAGE}",
            proxy=household.url,
            image_of=_cover_url_of_the_recording,
            max_bytes=1024,
        )

    assert image == thumbnail
    assert info["id"] == "BV1AC4y1L7Yi"
    assert [line.split()[:2] for line in household.requests] == [["GET", COVER_URL]]
    assert environment_proxy.requests == []


@refused_answers_are_left_to_the_collector
def test_a_refused_thumbnail_stops_details_lookup_without_replaying_the_request(
    no_outside_network: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    _recorded_page(monkeypatch)
    with (
        running_http_proxy({COVER_URL: Answer(403)}) as proxy,
        pytest.raises(RefusedError, match="403"),
    ):
        extract_with_image(
            f"http://{VIDEO_PAGE}",
            proxy=proxy.url,
            image_of=_cover_url_of_the_recording,
            max_bytes=1024,
        )

    assert [line.split()[:2] for line in proxy.requests] == [["GET", COVER_URL]]


def test_a_thumbnail_longer_than_the_limit_is_no_cover(
    no_outside_network: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    _recorded_page(monkeypatch)
    with running_http_proxy({COVER_URL: Answer(200, body=oversized_jpeg())}) as proxy:
        _, image = extract_with_image(
            f"http://{VIDEO_PAGE}",
            proxy=proxy.url,
            image_of=_cover_url_of_the_recording,
            max_bytes=1024,
        )

    assert image is None
