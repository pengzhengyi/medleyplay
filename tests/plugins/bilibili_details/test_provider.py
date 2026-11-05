"""The bilibili-details enricher reads a video's text and cover, and sorts what the site says."""

from collections.abc import Callable, Mapping
from pathlib import Path

import pytest

from medleyplay.plugin_api import EnrichStatus, EnrichTrack, NetworkError
from medleyplay.plugin_api.testing import check_track_enricher
from medleyplay.plugins.bilibili import _ytdlp
from medleyplay.plugins.bilibili_details.provider import BilibiliDetails
from tests.support.images import gif_image, jpeg_image
from tests.support.recordings import recorded_info

VIDEO = "BV1AC4y1L7Yi"
URL = f"https://www.bilibili.com/video/{VIDEO}"
PROXY = "socks5h://alice:hunter2@127.0.0.1:7890"


class Extractor:
    """A stand-in for yt-dlp's extraction: answers with the recorded video, or raises.

    It keeps the URL it was asked for and the proxy it was given.
    """

    def __init__(
        self,
        info: Mapping[str, object] | None = None,
        image: bytes | None = None,
        failure: Exception | None = None,
    ) -> None:
        self.info = recorded_info(VIDEO) if info is None else info
        self.image = image
        self.failure = failure
        self.asked: list[str] = []
        self.proxies: list[str | None] = []

    def __call__(
        self, url: str, *, proxy: str | None, image_of: Callable[..., str | None], max_bytes: int
    ) -> tuple[Mapping[str, object], bytes | None]:
        self.asked.append(url)
        self.proxies.append(proxy)
        if self.failure is not None:
            raise self.failure
        return self.info, self.image


def _ask(folder: Path, proxy: str | None = None) -> EnrichTrack:
    return EnrichTrack(video=VIDEO, folder=str(folder), proxy=proxy)


def test_the_recorded_answer_is_read_into_the_videos_text(tmp_path: Path) -> None:
    answer = BilibiliDetails(Extractor()).enrich(_ask(tmp_path))

    assert answer.status is EnrichStatus.OK
    assert answer.video_text is not None
    assert (answer.video_text.title, answer.video_text.description, answer.video_text.chapters) == (
        "【HR 24/48】朴树2003《生如夏花》专辑歌词版",
        "-",
        (),
    )
    assert answer.values == {}


def test_an_ask_without_a_video_is_a_fault_since_the_site_reads_only_videos(
    tmp_path: Path,
) -> None:
    with pytest.raises(ValueError, match="asked about a video"):
        BilibiliDetails(Extractor()).enrich(EnrichTrack(folder=str(tmp_path)))


def test_the_videos_page_is_the_only_url_asked(tmp_path: Path) -> None:
    extractor = Extractor()

    BilibiliDetails(extractor).enrich(_ask(tmp_path))

    assert extractor.asked == [URL]


def test_the_thumbnail_is_written_into_the_working_folder_under_the_name_answered(
    tmp_path: Path,
) -> None:
    thumbnail = jpeg_image("生如夏花")

    answer = BilibiliDetails(Extractor(image=thumbnail)).enrich(_ask(tmp_path))

    assert answer.cover is not None
    assert (tmp_path / answer.cover).read_bytes() == thumbnail


def test_a_video_whose_thumbnail_could_not_be_fetched_has_text_and_no_cover(
    tmp_path: Path,
) -> None:
    answer = BilibiliDetails(Extractor(image=None)).enrich(_ask(tmp_path))

    assert (answer.status, answer.cover, list(tmp_path.iterdir())) == (EnrichStatus.OK, None, [])
    assert answer.video_text is not None


def test_a_thumbnail_that_is_not_a_jpeg_png_or_webp_image_is_no_cover(tmp_path: Path) -> None:
    answer = BilibiliDetails(Extractor(image=gif_image())).enrich(_ask(tmp_path))

    assert (answer.cover, list(tmp_path.iterdir())) == (None, [])


@pytest.mark.parametrize(
    "refusal",
    [
        _ytdlp.RefusedError("Bilibili refused the request (412)."),
        _ytdlp.RefusedError("Bilibili refused the request: Unable to download video info: 352"),
    ],
)
def test_the_site_refusing_the_request_is_answered_as_refused(
    tmp_path: Path, refusal: Exception
) -> None:
    answer = BilibiliDetails(Extractor(failure=refusal)).enrich(_ask(tmp_path))

    assert (answer.status, answer.message) == (EnrichStatus.REFUSED, str(refusal))
    assert (answer.video_text, answer.cover) == (None, None)


@pytest.mark.parametrize(
    "failure",
    [
        _ytdlp.GoneError("This video may be deleted or geo-restricted."),
        _ytdlp.NeedsLoginError("This video is only available for registered users"),
    ],
    ids=["a video that does not exist", "a private video"],
)
def test_a_video_that_is_missing_or_private_is_answered_as_gone(
    tmp_path: Path, failure: Exception
) -> None:
    answer = BilibiliDetails(Extractor(failure=failure)).enrich(_ask(tmp_path))

    assert (answer.status, answer.message) == (EnrichStatus.GONE, str(failure))


def test_a_network_failure_is_raised_so_the_job_waits(tmp_path: Path) -> None:
    with pytest.raises(NetworkError):
        BilibiliDetails(Extractor(failure=NetworkError("timed out"))).enrich(_ask(tmp_path))


def test_any_other_failure_is_a_fault_of_the_plugin(tmp_path: Path) -> None:
    with pytest.raises(RuntimeError, match="initial state"):
        BilibiliDetails(Extractor(failure=RuntimeError("Unable to extract initial state"))).enrich(
            _ask(tmp_path)
        )


def test_the_requests_proxy_is_handed_to_the_extraction(tmp_path: Path) -> None:
    extractor = Extractor()

    BilibiliDetails(extractor).enrich(_ask(tmp_path, proxy=PROXY))

    assert extractor.proxies == [PROXY]


def test_a_request_without_a_proxy_extracts_without_one(tmp_path: Path) -> None:
    extractor = Extractor()

    BilibiliDetails(extractor).enrich(_ask(tmp_path))

    assert extractor.proxies == [None]


def test_the_enricher_keeps_the_contract(tmp_path: Path) -> None:
    answer = check_track_enricher(BilibiliDetails(Extractor(image=jpeg_image())), _ask(tmp_path))

    assert answer.cover is not None
