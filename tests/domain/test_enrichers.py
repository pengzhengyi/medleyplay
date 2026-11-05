"""Which Tracks an enricher is asked for, and how a Track's video is found."""

from datetime import UTC, datetime, timedelta

import pytest
from hypothesis import given
from hypothesis import strategies as st

from medleyplay.domain.catalog import TrackId
from medleyplay.domain.details import Field, Origin, Values
from medleyplay.domain.enrichers import (
    AI_DETAILS,
    ASK_AGAIN_AFTER,
    BILIBILI_DETAILS,
    MUSICBRAINZ,
    Enricher,
    Ineligible,
    SearchTerms,
    TrackFacts,
    enricher_named,
    search_terms,
    text_subject,
    video_id_of,
    why_not,
)
from medleyplay.domain.errors import NotFoundError

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
    assert why_not(a_track_with_a_video(), NOW, stopped=False, enricher=BILIBILI_DETAILS) is None


def test_a_track_without_a_video_is_not_asked_for() -> None:
    facts = a_track_with_a_video(video=None)

    assert why_not(facts, NOW, stopped=False, enricher=BILIBILI_DETAILS) is Ineligible.NO_VIDEO


def test_a_song_inside_a_longer_file_is_not_asked_for_since_its_album_file_is() -> None:
    facts = a_track_with_a_video(is_segment=True)

    assert why_not(facts, NOW, stopped=False, enricher=BILIBILI_DETAILS) is Ineligible.SEGMENT


@pytest.mark.parametrize("came_from", ["file", "household"])
def test_a_track_whose_video_text_came_from_a_file_or_the_household_is_not_asked_for(
    came_from: str,
) -> None:
    facts = a_track_with_a_video(text_came_from=came_from)

    assert why_not(facts, NOW, stopped=False, enricher=BILIBILI_DETAILS) is Ineligible.HAS_TEXT


def test_a_track_whose_video_text_came_from_the_site_is_asked_for_again_after_a_day() -> None:
    facts = a_track_with_a_video(text_came_from="site", asked_at=NOW - ASK_AGAIN_AFTER)

    assert why_not(facts, NOW, stopped=False, enricher=BILIBILI_DETAILS) is None


def test_a_video_asked_less_than_a_day_ago_is_not_asked_for_again() -> None:
    just_under = NOW - ASK_AGAIN_AFTER + timedelta(seconds=1)

    facts = a_track_with_a_video(asked_at=just_under)

    assert why_not(facts, NOW, stopped=False, enricher=BILIBILI_DETAILS) is Ineligible.ASKED


def test_a_stopped_enricher_asks_for_no_track() -> None:
    assert (
        why_not(a_track_with_a_video(), NOW, stopped=True, enricher=BILIBILI_DETAILS)
        is Ineligible.STOPPED
    )


@given(
    came_from=st.sampled_from(["file", "household"]),
    video=st.none() | st.just("BV1dm4y1s7ak"),
    asked_at=st.none() | st.just(NOW - timedelta(days=9)),
)
def test_text_from_a_file_or_the_household_is_never_replaced_by_the_site(
    came_from: str, video: str | None, asked_at: datetime | None
) -> None:
    facts = a_track_with_a_video(video=video, text_came_from=came_from, asked_at=asked_at)

    assert why_not(facts, NOW, stopped=False, enricher=BILIBILI_DETAILS) in {
        Ineligible.NO_VIDEO,
        Ineligible.HAS_TEXT,
    }


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


def test_the_musicbrainz_enricher_is_found_by_its_name() -> None:
    assert enricher_named("musicbrainz") is MUSICBRAINZ


def test_musicbrainz_is_asked_about_words_with_no_proxy_and_a_second_between_calls() -> None:
    assert (MUSICBRAINZ.origin, MUSICBRAINZ.spacing, MUSICBRAINZ.site) == (
        Origin.MUSICBRAINZ,
        timedelta(seconds=1),
        None,
    )


def test_an_enricher_that_does_not_exist_is_refused() -> None:
    with pytest.raises(NotFoundError, match="no such enricher") as refused:
        enricher_named("acoustid")

    assert "acoustid" not in str(refused.value)


def a_track_with_words(
    *, is_segment: bool = False, asked_at: datetime | None = None, subject: str | None = "a key"
) -> TrackFacts:
    """A Track with something to search for, never asked, that is not a segment, unless changed."""
    return TrackFacts(subject, is_segment, None, asked_at)


def test_a_track_with_words_to_search_for_is_asked_for() -> None:
    assert why_not(a_track_with_words(), NOW, stopped=False, enricher=MUSICBRAINZ) is None


def test_a_track_with_nothing_to_search_for_is_not_asked_for_and_the_reason_is_its_words() -> None:
    facts = a_track_with_words(subject=None)

    assert why_not(facts, NOW, stopped=False, enricher=MUSICBRAINZ) is Ineligible.NO_WORDS


def test_a_track_with_nothing_to_search_for_has_no_video_for_the_bilibili_enricher() -> None:
    facts = a_track_with_words(subject=None)

    assert why_not(facts, NOW, stopped=False, enricher=BILIBILI_DETAILS) is Ineligible.NO_VIDEO


def test_a_song_inside_a_longer_file_is_not_searched_for_either() -> None:
    facts = a_track_with_words(is_segment=True)

    assert why_not(facts, NOW, stopped=False, enricher=MUSICBRAINZ) is Ineligible.SEGMENT


def test_words_searched_for_less_than_a_day_ago_are_not_searched_for_again() -> None:
    facts = a_track_with_words(asked_at=NOW - ASK_AGAIN_AFTER + timedelta(seconds=1))

    assert why_not(facts, NOW, stopped=False, enricher=MUSICBRAINZ) is Ineligible.ASKED


def test_words_searched_for_a_day_ago_are_searched_for_again() -> None:
    facts = a_track_with_words(asked_at=NOW - ASK_AGAIN_AFTER)

    assert why_not(facts, NOW, stopped=False, enricher=MUSICBRAINZ) is None


def test_a_stopped_musicbrainz_asks_for_no_track() -> None:
    assert why_not(a_track_with_words(), NOW, stopped=True, enricher=MUSICBRAINZ) is (
        Ineligible.STOPPED
    )


def a_song(album: str | None = None) -> dict[Origin, Values]:
    """The values of a song the file's tags describe, on `album` when it has one.

    ```text
    files: title "Let Down", artist "Radiohead"
    ```
    """
    files: dict[Field, str | int] = {Field.TITLE: "Let Down", Field.ARTIST: "Radiohead"}
    if album is not None:
        files[Field.ALBUM] = album
    return {Origin.FILES: files}


def test_a_song_is_searched_for_by_its_title_and_artist() -> None:
    terms = search_terms(a_song(), whole_album=False)

    assert terms == SearchTerms("Let Down", "Radiohead", None, None, whole_album=False)


def test_a_known_album_is_part_of_what_a_song_is_searched_for_with() -> None:
    terms = search_terms(a_song(album="OK Computer"), whole_album=False)

    assert terms == SearchTerms("Let Down", "Radiohead", "OK Computer", None, whole_album=False)


def test_a_title_that_only_the_files_name_gives_is_no_search_term() -> None:
    values: dict[Origin, Values] = {
        Origin.FILE_NAME: {Field.TITLE: "Night Drive"},
        Origin.FILES: {Field.ARTIST: "Blue Room"},
    }

    assert search_terms(values, whole_album=False) is None


def test_a_song_without_an_artist_is_not_searched_for() -> None:
    values: dict[Origin, Values] = {Origin.FILES: {Field.TITLE: "Let Down"}}

    assert search_terms(values, whole_album=False) is None


def test_the_households_title_is_searched_for_over_the_files() -> None:
    values = a_song() | {Origin.HOUSEHOLD: {Field.TITLE: "Let Down (Live)"}}

    terms = search_terms(values, whole_album=False)

    assert terms is not None
    assert terms.title == "Let Down (Live)"


def test_what_musicbrainz_itself_said_is_no_search_term() -> None:
    values: dict[Origin, Values] = {
        Origin.MUSICBRAINZ: {Field.TITLE: "Let Down", Field.ARTIST: "Radiohead"},
    }

    assert search_terms(values, whole_album=False) is None


def test_a_search_term_ignores_what_musicbrainz_said_over_the_files_word() -> None:
    values = a_song() | {Origin.MUSICBRAINZ: {Field.TITLE: "Let Down!", Field.ALBUM: "Elsewhere"}}

    assert search_terms(values, whole_album=False) == search_terms(a_song(), whole_album=False)


def test_a_long_file_split_into_songs_is_searched_for_by_its_album_and_album_artist() -> None:
    values: dict[Origin, Values] = {
        Origin.VIDEO: {Field.ALBUM: "生如夏花", Field.ALBUM_ARTIST: "朴树"},
    }

    terms = search_terms(values, whole_album=True)

    assert terms == SearchTerms(None, None, "生如夏花", "朴树", whole_album=True)


def test_a_long_file_without_an_album_artist_is_searched_for_by_its_artist() -> None:
    values: dict[Origin, Values] = {Origin.VIDEO: {Field.ALBUM: "生如夏花", Field.ARTIST: "朴树"}}

    terms = search_terms(values, whole_album=True)

    assert terms is not None
    assert terms.album_artist == "朴树"


def test_a_long_file_is_never_searched_for_as_one_song() -> None:
    assert search_terms(a_song(), whole_album=True) is None


def test_a_long_file_without_an_album_is_not_searched_for() -> None:
    values: dict[Origin, Values] = {Origin.VIDEO: {Field.ALBUM_ARTIST: "朴树"}}

    assert search_terms(values, whole_album=True) is None


def test_the_same_terms_of_another_track_are_another_subject() -> None:
    terms = SearchTerms("Let Down", "Radiohead", None, None, whole_album=False)

    assert terms.key(TrackId(1)) != terms.key(TrackId(2))


def test_the_same_track_with_other_terms_is_another_subject() -> None:
    track = TrackId(1)
    before = SearchTerms("Let Down", "Radiohead", None, None, whole_album=False)
    after = SearchTerms("Let Down", "Radiohead", "OK Computer", None, whole_album=False)

    assert before.key(track) != after.key(track)


def test_the_same_track_with_the_same_terms_is_the_same_subject_that_fits_a_column() -> None:
    terms = SearchTerms("Let Down", "Radiohead", None, None, whole_album=False)

    assert terms.key(TrackId(7)) == terms.key(TrackId(7))
    assert len(terms.key(TrackId(7))) <= 64


def a_track_with_video_text(
    *,
    is_segment: bool = False,
    text_came_from: str | None = "site",
    asked_at: datetime | None = None,
    subject: str | None = "a key",
) -> TrackFacts:
    """A Track whose video text the site gave, never asked of the AI, that is no segment.

    ```text
    video text from the site, never suggested from, not a segment
    ```
    """
    return TrackFacts(subject, is_segment, text_came_from, asked_at)


def test_the_ai_enricher_is_found_by_its_name() -> None:
    assert enricher_named("ai-details") is AI_DETAILS


def test_the_ai_enricher_suggests_from_video_text_with_no_proxy_and_two_seconds_between_calls() -> (
    None
):
    assert (AI_DETAILS.origin, AI_DETAILS.spacing, AI_DETAILS.site) == (
        Origin.AI,
        timedelta(seconds=2),
        None,
    )


def test_a_track_with_video_text_is_asked_of_the_ai() -> None:
    facts = a_track_with_video_text()

    assert why_not(facts, NOW, stopped=False, enricher=AI_DETAILS) is None


@pytest.mark.parametrize("came_from", ["site", "file", "household"])
def test_video_text_is_read_by_the_ai_wherever_it_came_from(came_from: str) -> None:
    facts = a_track_with_video_text(text_came_from=came_from)

    assert why_not(facts, NOW, stopped=False, enricher=AI_DETAILS) is None


def test_a_track_without_video_text_is_not_asked_of_the_ai_and_the_reason_is_its_text() -> None:
    facts = a_track_with_video_text(subject=None, text_came_from=None)

    assert why_not(facts, NOW, stopped=False, enricher=AI_DETAILS) is Ineligible.NO_TEXT


def test_a_song_inside_a_longer_file_is_not_asked_of_the_ai() -> None:
    facts = a_track_with_video_text(is_segment=True)

    assert why_not(facts, NOW, stopped=False, enricher=AI_DETAILS) is Ineligible.SEGMENT


def test_a_track_asked_of_the_ai_less_than_a_day_ago_is_not_asked_again() -> None:
    facts = a_track_with_video_text(asked_at=NOW - ASK_AGAIN_AFTER + timedelta(seconds=1))

    assert why_not(facts, NOW, stopped=False, enricher=AI_DETAILS) is Ineligible.ASKED


def test_a_track_asked_of_the_ai_a_day_ago_is_asked_again() -> None:
    facts = a_track_with_video_text(asked_at=NOW - ASK_AGAIN_AFTER)

    assert why_not(facts, NOW, stopped=False, enricher=AI_DETAILS) is None


def test_a_stopped_ai_enricher_asks_for_no_track() -> None:
    assert why_not(a_track_with_video_text(), NOW, stopped=True, enricher=AI_DETAILS) is (
        Ineligible.STOPPED
    )


def test_the_ai_enricher_asks_for_no_track_until_the_provider_is_set_up() -> None:
    assert (
        why_not(a_track_with_video_text(), NOW, stopped=False, enricher=AI_DETAILS, set_up=False)
        is Ineligible.NOT_SET_UP
    )


@pytest.mark.parametrize("enricher", [BILIBILI_DETAILS, MUSICBRAINZ])
def test_an_enricher_that_needs_no_provider_asks_for_a_track_whether_or_not_one_is_set_up(
    enricher: Enricher,
) -> None:
    facts = TrackFacts("a key", is_segment=False, text_came_from=None, asked_at=None)

    assert why_not(facts, NOW, stopped=False, enricher=enricher, set_up=False) is None


def test_one_track_is_one_subject_of_the_ai_whatever_its_text_says() -> None:
    assert text_subject(TrackId(7)) == text_subject(TrackId(7))
    assert text_subject(TrackId(7)) != text_subject(TrackId(8))
    assert len(text_subject(TrackId(7))) <= 64
