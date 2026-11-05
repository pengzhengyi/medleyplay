"""The plugin reads yt-dlp's info as the recorded answer for a real video has it."""

from collections.abc import Mapping

import pytest

from medleyplay.plugin_api import Chapter, ReadVideo, VideoStatus
from medleyplay.plugins.bilibili.providers import BilibiliResolver
from medleyplay.plugins.bilibili.videos import (
    audio_qualities,
    codecs,
    cover_url,
    video_details,
    video_text,
)
from tests.plugins.bilibili.infos import YtDlpInfoFactory
from tests.support.recordings import recorded_info

RECORDED = "BV1AC4y1L7Yi"


def test_the_recorded_video_reads_as_one_part_with_its_title_uploader_and_length() -> None:
    details = video_details(recorded_info(RECORDED))

    assert details.title == "【HR 24/48】朴树2003《生如夏花》专辑歌词版"
    assert details.uploader == "HiRes无损体验馆"
    assert [(part.part, part.title, part.duration_ms) for part in details.parts] == [
        (1, "【HR 24/48】朴树2003《生如夏花》专辑歌词版", 2_961_322)
    ]


def test_the_recorded_video_offers_its_three_aac_qualities_best_first() -> None:
    qualities = audio_qualities(recorded_info(RECORDED))

    assert [(quality.id, quality.kbps) for quality in qualities] == [
        ("30280", 192),
        ("30232", 132),
        ("30216", 64),
    ]


def test_the_recorded_videos_audio_codecs_are_named_for_a_video_that_cant_be_served() -> None:
    assert codecs(recorded_info(RECORDED)) == "mp4a.40.2, mp4a.40.5"


def test_the_resolver_reads_the_recorded_video_as_ok() -> None:
    def extract(url: str, *, playlist: bool, proxy: str | None = None) -> Mapping[str, object]:
        return recorded_info(RECORDED)

    details = BilibiliResolver(extract=extract).read(ReadVideo(video=RECORDED))

    assert (details.status, details.title) == (
        VideoStatus.OK,
        "【HR 24/48】朴树2003《生如夏花》专辑歌词版",
    )


@pytest.mark.parametrize("key", ["id", "title", "uploader", "duration", "formats"])
def test_the_made_info_agrees_with_the_recording_on_every_field_the_plugin_reads(
    key: str,
) -> None:
    recorded, made = recorded_info(RECORDED), YtDlpInfoFactory.single()

    assert type(made[key]) is type(recorded[key]) or {type(made[key]), type(recorded[key])} == {
        int,
        float,
    }


def test_a_made_format_agrees_with_a_recorded_format_on_the_fields_the_plugin_reads() -> None:
    recorded, made = recorded_info(RECORDED)["formats"], YtDlpInfoFactory.single()["formats"]
    assert isinstance(recorded, list)
    assert isinstance(made, list)

    for key in ("format_id", "acodec", "vcodec"):
        assert type(recorded[0][key]) is type(made[0][key])


def test_the_recorded_videos_text_is_its_title_and_description() -> None:
    text = video_text(recorded_info(RECORDED))

    assert (text.title, text.description, text.chapters) == (
        "【HR 24/48】朴树2003《生如夏花》专辑歌词版",
        "-",
        (),
    )


def test_a_videos_chapters_are_read_with_their_starts_in_milliseconds() -> None:
    info = {
        **recorded_info(RECORDED),
        "chapters": [
            {"start_time": 0.0, "end_time": 252.5, "title": "アイネクライネ"},
            {"start_time": 252.5, "end_time": 300.0, "title": "ゴーゴー幽霊船"},
        ],
    }

    assert video_text(info).chapters == (
        Chapter(start_ms=0, title="アイネクライネ"),
        Chapter(start_ms=252_500, title="ゴーゴー幽霊船"),
    )


def test_a_chapter_with_no_start_a_negative_start_or_a_start_past_a_week_is_left_out() -> None:
    info = {
        **recorded_info(RECORDED),
        "chapters": [
            {"title": "No start"},
            {"start_time": -1, "title": "Before"},
            {"start_time": 8 * 24 * 3600, "title": "Much later"},
            {"start_time": 5, "title": "Kept"},
        ],
    }

    assert video_text(info).chapters == (Chapter(start_ms=5_000, title="Kept"),)


def test_text_longer_than_the_limits_is_cut_to_them() -> None:
    info = {**recorded_info(RECORDED), "title": "t" * 2_000, "description": "d" * 30_000}

    text = video_text(info)

    assert (len(text.title), len(text.description)) == (1_000, 20_000)


def test_the_first_part_of_an_anthology_is_titled_by_the_video_not_by_its_part() -> None:
    text = video_text(YtDlpInfoFactory.anthology_first_part())

    assert text.title == "【MV】Night Drive"


def test_a_title_of_a_video_with_one_part_keeps_a_p01_inside_it() -> None:
    info = {**recorded_info(RECORDED), "title": "Mix p01 live"}

    assert video_text(info).title == "Mix p01 live"


def test_the_recorded_videos_cover_is_the_thumbnail_it_names() -> None:
    assert cover_url(recorded_info(RECORDED)) == (
        "http://i2.hdslb.com/bfs/archive/ffd2e726d214bc076f6eb9fdae103bd9d8ff7e73.jpg"
    )


def test_a_cover_is_the_last_thumbnail_when_the_info_names_no_thumbnail() -> None:
    info = {
        "thumbnails": [
            {"url": "https://i0.hdslb.com/bfs/small.jpg"},
            {"url": "https://i0.hdslb.com/bfs/large.jpg"},
        ]
    }

    assert cover_url(info) == "https://i0.hdslb.com/bfs/large.jpg"


@pytest.mark.parametrize(
    "url",
    [
        "https://evil.example/bfs/archive/a.jpg",
        "https://hdslb.com.evil.example/a.jpg",
        "file:///etc/hosts",
        "ftp://i0.hdslb.com/a.jpg",
        "https://127.0.0.1/a.jpg",
    ],
)
def test_a_cover_off_bilibili_is_not_fetched(url: str) -> None:
    assert cover_url({"thumbnail": url}) is None


def test_a_video_with_no_thumbnail_has_no_cover() -> None:
    assert cover_url({}) is None
