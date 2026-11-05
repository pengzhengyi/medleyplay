"""Which Tracks an enricher is asked for, and how a Track's video is found."""

from datetime import UTC, datetime, timedelta

import pytest
from hypothesis import given
from hypothesis import strategies as st

from medleyplay.domain.enrichers import (
    ASK_AGAIN_AFTER,
    BILIBILI_DETAILS,
    Ineligible,
    TrackFacts,
    enricher_named,
    video_id_of,
    why_not,
)
from medleyplay.domain.errors import InvalidInputError

NOW = datetime(2026, 11, 5, 12, tzinfo=UTC)


def a_track_with_a_video(
    *,
    video: str | None = "BV1dm4y1s7ak",
    is_segment: bool = False,
    text_came_from: str | None = None,
    asked_at: datetime | None = None,
) -> TrackFacts:
    """A Track whose video was never asked about and that has no video text, unless changed.

    ```text
    video BV1dm4y1s7ak, not a segment, no text, never asked
    ```
    """
    return TrackFacts(video, is_segment, text_came_from, asked_at)


def test_a_track_with_a_video_and_no_text_is_asked_for() -> None:
    assert why_not(a_track_with_a_video(), NOW, stopped=False) is None


def test_a_track_without_a_video_is_not_asked_for() -> None:
    facts = a_track_with_a_video(video=None)

    assert why_not(facts, NOW, stopped=False) is Ineligible.NO_VIDEO


def test_a_song_inside_a_longer_file_is_not_asked_for_since_its_album_file_is() -> None:
    facts = a_track_with_a_video(is_segment=True)

    assert why_not(facts, NOW, stopped=False) is Ineligible.SEGMENT


@pytest.mark.parametrize("came_from", ["file", "household"])
def test_a_track_whose_video_text_came_from_a_file_or_the_household_is_not_asked_for(
    came_from: str,
) -> None:
    facts = a_track_with_a_video(text_came_from=came_from)

    assert why_not(facts, NOW, stopped=False) is Ineligible.HAS_TEXT


def test_a_track_whose_video_text_came_from_the_site_is_asked_for_again_after_a_day() -> None:
    facts = a_track_with_a_video(text_came_from="site", asked_at=NOW - ASK_AGAIN_AFTER)

    assert why_not(facts, NOW, stopped=False) is None


def test_a_video_asked_less_than_a_day_ago_is_not_asked_for_again() -> None:
    just_under = NOW - ASK_AGAIN_AFTER + timedelta(seconds=1)

    facts = a_track_with_a_video(asked_at=just_under)

    assert why_not(facts, NOW, stopped=False) is Ineligible.ASKED


def test_a_stopped_enricher_asks_for_no_track() -> None:
    assert why_not(a_track_with_a_video(), NOW, stopped=True) is Ineligible.STOPPED


@given(
    came_from=st.sampled_from(["file", "household"]),
    video=st.none() | st.just("BV1dm4y1s7ak"),
    asked_at=st.none() | st.just(NOW - timedelta(days=9)),
)
def test_text_from_a_file_or_the_household_is_never_replaced_by_the_site(
    came_from: str, video: str | None, asked_at: datetime | None
) -> None:
    facts = a_track_with_a_video(video=video, text_came_from=came_from, asked_at=asked_at)

    assert why_not(facts, NOW, stopped=False) in {Ineligible.NO_VIDEO, Ineligible.HAS_TEXT}


def test_a_bilibili_source_names_its_video() -> None:
    assert video_id_of([("bilibili", "BV1Xx41117Tz/p2")]) == "BV1Xx41117Tz"


@pytest.mark.parametrize(
    ("locator", "video"),
    [
        ("3/Music/BV1dm4y1s7ak.m4a", "BV1dm4y1s7ak"),
        ("3/BV1dm4y1s7ak.M4A", "BV1dm4y1s7ak"),
        ("3/Music/BV1dm4y1s7ak - Mixtape.m4a", None),
        ("3/Music/BV1dm4y1s7ak0.m4a", None),
        ("3/Music/Night Drive.m4a", None),
    ],
)
def test_a_library_file_named_for_a_video_names_it(locator: str, video: str | None) -> None:
    assert video_id_of([("library", locator)]) == video


def test_a_bilibili_source_wins_over_a_file_named_for_another_video() -> None:
    sources = [("library", "3/BV1dm4y1s7ak.m4a"), ("bilibili", "BV1Xx41117Tz/p1")]

    assert video_id_of(sources) == "BV1Xx41117Tz"


def test_a_segments_source_names_no_video() -> None:
    assert video_id_of([("segment", "7/12")]) is None


def test_the_bilibili_enricher_is_found_by_its_name() -> None:
    assert enricher_named("bilibili-details") is BILIBILI_DETAILS


def test_an_enricher_that_does_not_exist_is_refused() -> None:
    with pytest.raises(InvalidInputError, match="no enricher called"):
        enricher_named("musicbrainz")
