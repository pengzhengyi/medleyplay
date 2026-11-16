"""Split offers: which list a long file may be split by, and whether it can be trusted."""

import json
from pathlib import Path
from typing import Any

import pytest

from medleyplay.domain.split_offers import Doubt, OfferSource, doubts_of, offer_of
from medleyplay.domain.video_text import Song

MINUTE = 60_000
SHARED = Path(__file__).parents[2] / "web" / "src" / "library" / "splitDoubts.cases.json"
"""The cases the web client's song editor judges doubts by too, in minutes."""


def _shared_cases() -> list[dict[str, Any]]:
    cases: list[dict[str, Any]] = json.loads(SHARED.read_text(encoding="utf-8"))["cases"]
    return cases


def songs_at(*minutes: float) -> tuple[Song, ...]:
    """Songs starting at each of `minutes`, titled *Song 1*, *Song 2*, …."""
    return tuple(
        Song(round(start * MINUTE), f"Song {place}") for place, start in enumerate(minutes, 1)
    )


TWELVE = songs_at(*range(0, 48, 4))
"""Twelve songs of four minutes each, in a 48-minute file."""


@pytest.mark.parametrize("case", _shared_cases(), ids=lambda case: case["name"])
def test_doubts_are_judged_as_the_song_editor_judges_them(case: dict[str, Any]) -> None:
    length = None if case["length"] is None else case["length"] * MINUTE

    doubts = doubts_of([start * MINUTE for start in case["starts"]], length)

    assert (sorted(doubts.long), doubts.few) == (case["long"], case["few"])


def test_the_video_and_the_ai_agreeing_within_seconds_are_offered_from_both_and_trusted() -> None:
    ai = songs_at(*(start + 0.04 for start in range(0, 48, 4)))

    offer = offer_of(TWELVE, ai, 48 * MINUTE)

    assert offer is not None
    assert (offer.source, offer.doubts, offer.trusted) == (OfferSource.BOTH, (), True)
    assert offer.songs == TWELVE


def test_lists_that_differ_offer_the_videos_doubted() -> None:
    offer = offer_of(TWELVE, songs_at(0, 24), 48 * MINUTE)

    assert offer is not None
    assert (offer.source, offer.songs, offer.trusted) == (OfferSource.VIDEO, TWELVE, False)
    assert Doubt.LISTS_DIFFER in offer.doubts


@pytest.mark.parametrize(
    ("video", "ai", "source"),
    [(TWELVE, (), OfferSource.VIDEO), ((), TWELVE, OfferSource.AI)],
    ids=["the video's", "the AI's"],
)
def test_one_list_raising_no_doubt_is_trusted(
    video: tuple[Song, ...], ai: tuple[Song, ...], source: OfferSource
) -> None:
    offer = offer_of(video, ai, 48 * MINUTE)

    assert offer is not None
    assert (offer.source, offer.trusted) == (source, True)


def test_one_list_with_a_song_so_long_it_may_be_two_is_doubted() -> None:
    offer = offer_of(songs_at(0, 4, 24), (), 28 * MINUTE)

    assert offer is not None
    assert (offer.doubts, offer.trusted) == ((Doubt.LONG_SONG,), False)


def test_agreeing_lists_are_trusted_despite_a_long_song_as_a_live_sets_are() -> None:
    offer = offer_of(songs_at(0, 4, 24), songs_at(0, 4, 24), 28 * MINUTE)

    assert offer is not None
    assert (offer.doubts, offer.trusted) == ((Doubt.LONG_SONG,), True)


def test_nothing_is_trusted_against_a_file_of_unknown_length() -> None:
    offer = offer_of(TWELVE, TWELVE, None)

    assert offer is not None
    assert (Doubt.UNKNOWN_LENGTH in offer.doubts, offer.trusted) == (True, False)


def test_a_list_whose_last_song_starts_at_the_files_end_cannot_be_saved_so_is_not_trusted() -> None:
    offer = offer_of(songs_at(0, 4, 48), songs_at(0, 4, 48), 48 * MINUTE)

    assert offer is not None
    assert (Doubt.INVALID in offer.doubts, offer.trusted) == (True, False)


def test_a_file_with_no_list_has_no_offer() -> None:
    assert offer_of((), (), 48 * MINUTE) is None


def test_an_offers_signature_changes_with_its_starts() -> None:
    first = offer_of(TWELVE, (), 48 * MINUTE)
    moved = offer_of(songs_at(0, 5, *range(8, 48, 4)), (), 48 * MINUTE)

    assert first is not None
    assert moved is not None
    assert first.signature != moved.signature
