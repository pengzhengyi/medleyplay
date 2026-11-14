import pytest

from medleyplay.domain.artists import (
    Alias,
    Artist,
    Candidate,
    LookUp,
    artist_key,
    may_look_up,
    suggested,
)

BEATLES = Artist("b10bbbfc", "The Beatles", "Beatles, The", "", "GB")
TRIBUTE = Artist("6a3b5c1e", "披头士乐队纪念乐团", "", "Beatles tribute band", "CN")


def _beatles(score: int = 100) -> Candidate:
    """The Beatles, known as 披头士 and 披頭四 too."""
    return Candidate(
        BEATLES,
        score,
        (Alias("披头士", "zh", primary=True), Alias("披頭四", "zh_Hant")),
    )


def test_a_name_is_kept_by_its_folded_form() -> None:
    assert artist_key("  ＴＨＥ Beatles ") == artist_key("the beatles")  # noqa: RUF001 -- full-width


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("披头士", LookUp.YES),
        ("Various Artists", LookUp.NEVER),
        ("群星", LookUp.NEVER),
        ("佚名", LookUp.NEVER),
        ("Unknown Artist", LookUp.NEVER),
        ("", LookUp.NEVER),
        ("周杰伦2000年发行首张个人", LookUp.TIDY_FIRST),
    ],
)
def test_a_name_is_looked_up_unless_it_names_no_one_or_needs_tidying_first(
    name: str, expected: LookUp
) -> None:
    assert may_look_up(name) is expected


def test_the_one_artist_going_by_the_name_exactly_is_suggested() -> None:
    assert suggested("披头士", [_beatles(), Candidate(TRIBUTE, 61, ())]) == BEATLES.id


def test_an_artist_matching_only_loosely_is_not_suggested() -> None:
    assert suggested("披头士乐队", [_beatles(), Candidate(TRIBUTE, 61, ())]) is None


def test_an_exact_match_the_site_scores_low_is_not_suggested() -> None:
    assert suggested("披头士", [_beatles(score=80)]) is None


def test_two_artists_going_by_the_name_suggest_neither() -> None:
    other = Candidate(Artist("7e1a9b2c", "披头士", "", "a Shanghai band", "CN"), 100, ())

    assert suggested("披头士", [_beatles(), other]) is None


def test_the_sort_name_counts_as_a_name() -> None:
    assert suggested("Beatles, The", [_beatles()]) == BEATLES.id
