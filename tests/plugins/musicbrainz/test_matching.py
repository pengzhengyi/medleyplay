"""The queries MusicBrainz is searched with, and how its candidates are ranked."""

import pytest

from medleyplay.plugins.musicbrainz.matching import (
    Candidate,
    best,
    escape_lucene,
    recording_query,
    release_query,
    same_title,
    within_window,
)


def a_release(
    title: str = "OK Computer",
    *,
    score: int = 100,
    official: bool = True,
    date: str | None = "1997-05-21",
    release: str = "a-release",
) -> Candidate:
    """A release scoring 100 that is official, called OK Computer, and dated 1997-05-21."""
    return Candidate(release, title, score, official, date)


def full_width(text: str) -> str:
    """`text` with its letters in full width, as Japanese text sets them."""
    return "".join(
        chr(ord(each) + 0xFEE0) if each.isascii() and each.isalpha() else each for each in text
    )


@pytest.mark.parametrize("syntax", list('+-&|!(){}[]^"~*?:\\/'))
def test_every_character_the_query_parser_reads_as_syntax_is_escaped(syntax: str) -> None:
    assert escape_lucene(f"a{syntax}b") == f"a\\{syntax}b"


def test_text_without_syntax_is_left_as_it_is() -> None:
    assert escape_lucene("OK Computer 生如夏花 過食性") == "OK Computer 生如夏花 過食性"


def test_a_recording_is_searched_by_its_title_and_artist() -> None:
    assert recording_query("Let Down", "Radiohead") == 'recording:"Let Down" AND artist:"Radiohead"'


def test_a_known_album_narrows_the_search_to_its_release() -> None:
    query = recording_query("Let Down", "Radiohead", "OK Computer")

    assert query == 'recording:"Let Down" AND artist:"Radiohead" AND release:"OK Computer"'


def test_japanese_text_keeps_its_characters_and_has_only_its_syntax_escaped() -> None:
    query = recording_query("過食性:アイドル症候群", "GUMI/MAYU", "ケビョウニンゲン")

    assert query == (
        'recording:"過食性\\:アイドル症候群" AND artist:"GUMI\\/MAYU"'
        ' AND release:"ケビョウニンゲン"'
    )


def test_a_quote_in_a_title_cannot_end_the_phrase_it_is_in() -> None:
    assert recording_query('Say "Hi"', "A") == 'recording:"Say \\"Hi\\"" AND artist:"A"'


def test_a_release_is_searched_by_its_title_and_artist() -> None:
    assert release_query("生如夏花", "朴树") == 'release:"生如夏花" AND artist:"朴树"'


@pytest.mark.parametrize(
    ("first", "second"),
    [("OK Computer", "ok computer"), (full_width("OK Computer"), "OK Computer"), (" Ok ", "OK")],
    ids=["case", "full width letters", "surrounding space"],
)
def test_two_titles_differing_in_case_or_width_are_the_same(first: str, second: str) -> None:
    assert same_title(first, second)


def test_two_different_titles_are_not_the_same() -> None:
    assert not same_title("OK Computer", "OKNOTOK")


@pytest.mark.parametrize("found_ms", [294_000, 299_000, 304_000])
def test_a_recording_within_five_seconds_of_the_track_is_in_the_window(found_ms: int) -> None:
    assert within_window(299_000, found_ms)


@pytest.mark.parametrize("found_ms", [293_999, 304_001])
def test_a_recording_more_than_five_seconds_from_the_track_is_out_of_the_window(
    found_ms: int,
) -> None:
    assert not within_window(299_000, found_ms)


@pytest.mark.parametrize(
    ("wanted_ms", "found_ms"), [(None, 299_000), (299_000, None), (None, None)]
)
def test_a_length_that_is_unknown_never_rules_a_recording_out(
    wanted_ms: int | None, found_ms: int | None
) -> None:
    assert within_window(wanted_ms, found_ms)


def test_the_earliest_of_two_releases_is_the_original_over_a_reissue() -> None:
    original = a_release(date="1997-05-21", release="1997")
    reissue = a_release(date="2016-05-01", release="2016")

    assert best([reissue, original], "OK Computer") == original


def test_a_release_scoring_under_ninety_is_never_chosen() -> None:
    assert best([a_release(score=89)], "OK Computer") is None


def test_a_release_scoring_exactly_ninety_may_be_chosen() -> None:
    candidate = a_release(score=90)

    assert best([candidate], "OK Computer") == candidate


def test_the_higher_score_wins_over_a_named_album_and_an_earlier_date() -> None:
    scoring_higher = a_release("Other", score=100, date="2016-01-01", release="high")
    named_and_earlier = a_release("OK Computer", score=95, date="1997-05-21", release="low")

    assert best([named_and_earlier, scoring_higher], "OK Computer") == scoring_higher


def test_among_equal_scores_the_release_named_like_the_album_wins_over_an_earlier_one() -> None:
    named = a_release("OK Computer", date="2016-05-01", release="named")
    compilation = a_release("The Best Of", date="1997-01-01", release="compilation")

    assert best([compilation, named], "ok computer") == named


def test_the_album_is_matched_ignoring_the_width_of_characters() -> None:
    named = a_release("OK Computer", date="2016-05-01", release="named")
    compilation = a_release("The Best Of", date="1997-01-01", release="compilation")

    assert best([compilation, named], full_width("OK Computer")) == named


def test_among_releases_named_alike_an_official_one_wins_over_a_bootleg() -> None:
    bootleg = a_release(official=False, date="1990-01-01", release="bootleg")
    official = a_release(official=True, date="2016-05-01", release="official")

    assert best([bootleg, official], "OK Computer") == official


def test_without_a_known_album_an_official_release_wins_over_an_earlier_bootleg() -> None:
    bootleg = a_release("Greatest Hits", official=False, date="1990-01-01", release="bootleg")
    official = a_release("OK Computer", official=True, date="2016-05-01", release="official")

    assert best([bootleg, official], None) == official


def test_a_day_is_earlier_than_the_year_it_is_in() -> None:
    year_only = a_release(date="1997", release="year")
    exact = a_release(date="1997-05-21", release="day")

    assert best([year_only, exact], "OK Computer") == exact


def test_a_release_with_no_date_comes_after_one_with_a_date() -> None:
    undated = a_release(date=None, release="undated")
    dated = a_release(date="2016", release="dated")

    assert best([undated, dated], "OK Computer") == dated


def test_a_release_with_an_unreadable_date_comes_after_one_with_a_date() -> None:
    unreadable = a_release(date="spring 1997", release="unreadable")
    dated = a_release(date="2016", release="dated")

    assert best([unreadable, dated], "OK Computer") == dated


def test_no_candidates_choose_nothing() -> None:
    assert best([], "OK Computer") is None
