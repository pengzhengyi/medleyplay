"""The Source models: what a resolver, a downloader, and a login check may say."""

from datetime import datetime

import pytest
from pydantic import ValidationError

from medleyplay.plugin_api import (
    AudioQuality,
    Canonical,
    Canonicalize,
    CheckedLogin,
    Downloaded,
    DownloadPart,
    PartDetails,
    ReadVideo,
    VideoDetails,
    VideoStatus,
)


@pytest.mark.parametrize("video", ["../etc", "BV1Xx41117Tz/p1", "https://b23.tv/x", "", "a b"])
def test_a_video_id_is_never_a_path_or_a_link(video: str) -> None:
    with pytest.raises(ValidationError):
        Canonical(video=video, link="https://www.bilibili.com/")


@pytest.mark.parametrize("part", [0, -1, 10_000])
def test_a_part_is_numbered_from_one(part: int) -> None:
    with pytest.raises(ValidationError):
        PartDetails(part=part, title="Intro")


def test_a_link_to_something_but_a_video_names_no_video() -> None:
    canonical = Canonical(video=None, link="https://space.bilibili.com/1234")

    assert canonical.part is None


def test_a_video_that_cant_be_read_says_why_with_no_details() -> None:
    details = VideoDetails(status=VideoStatus.GONE, message="The video was removed.")

    assert details.parts == ()
    assert details.qualities == ()


@pytest.mark.parametrize("quality", ["Best", "30280 kbps", "../x", ""])
def test_a_quality_is_a_plain_name(quality: str) -> None:
    with pytest.raises(ValidationError):
        AudioQuality(id=quality, label="Best")
    with pytest.raises(ValidationError):
        DownloadPart(video="BV1Xx41117Tz", part=1, quality=quality, folder="/jobs/1")


def test_a_download_names_its_file_or_says_the_part_is_gone() -> None:
    assert Downloaded(file="BV1Xx41117Tz_p1.m4a", quality="30280", backend="yt-dlp").gone is False
    assert Downloaded(file=None, gone=True, message="Removed.").file is None


def test_a_login_expiry_says_its_time_zone() -> None:
    with pytest.raises(ValidationError):
        CheckedLogin(valid=True, login="x", expires_at=datetime(2027, 4, 8))  # noqa: DTZ001 -- the naive time is the point


PROXY = "socks5h://alice:hunter2@127.0.0.1:7890"


def _download(proxy: str | None = None) -> DownloadPart:
    return DownloadPart(video="BV1Xx41117Tz", part=1, quality="best", folder="/jobs/1", proxy=proxy)


def test_a_request_that_reaches_a_site_has_no_proxy_unless_given_one() -> None:
    assert Canonicalize(link="https://b23.tv/abc123").proxy is None
    assert ReadVideo(video="BV1Xx41117Tz").proxy is None
    assert _download().proxy is None


@pytest.mark.parametrize(
    "request_model",
    [
        Canonicalize(link="https://b23.tv/abc123", proxy=PROXY),
        ReadVideo(video="BV1Xx41117Tz", proxy=PROXY),
        _download(PROXY),
    ],
)
def test_a_request_that_reaches_a_site_carries_the_proxy_across_the_pipe(
    request_model: Canonicalize | ReadVideo | DownloadPart,
) -> None:
    again = type(request_model).model_validate_json(request_model.model_dump_json())

    assert again == request_model
    assert again.proxy == PROXY


@pytest.mark.parametrize(
    "request_model",
    [
        Canonicalize(link="https://b23.tv/abc123", proxy=PROXY),
        ReadVideo(video="BV1Xx41117Tz", proxy=PROXY),
        _download(PROXY),
    ],
)
def test_a_request_never_shows_its_proxy_when_printed(
    request_model: Canonicalize | ReadVideo | DownloadPart,
) -> None:
    assert "hunter2" not in repr(request_model)


def test_a_proxy_is_at_most_512_characters() -> None:
    with pytest.raises(ValidationError):
        ReadVideo(video="BV1Xx41117Tz", proxy="http://" + "a" * 512)


def test_a_request_written_before_the_proxy_existed_still_reads_without_one() -> None:
    written = '{"link": "https://b23.tv/abc123"}'

    assert Canonicalize.model_validate_json(written) == Canonicalize(link="https://b23.tv/abc123")
