import pytest

from medleyplay.domain.artists import (
    Alias,
    Artist,
    Candidate,
    LookUp,
    artist_key,
    may_look_up,
    queries_for,
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


@pytest.mark.parametrize(
    ("name", "queries"),
    [
        ("披头士", ("披头士",)),
        (
            "Michael Jackson/迈克尔·杰克逊",
            ("Michael Jackson/迈克尔·杰克逊", "Michael Jackson", "迈克尔·杰克逊"),
        ),
        ("Adele阿黛尔", ("Adele阿黛尔", "Adele", "阿黛尔")),
        ("逃跑计划Escape Plan", ("逃跑计划Escape Plan", "逃跑计划", "Escape Plan")),
        ("初音ミク/米津玄師", ("初音ミク/米津玄師", "初音ミク", "米津玄師")),
        ("AC/DC", ("AC/DC",)),
        (
            "Adele/阿黛尔/阿黛儿",
            ("Adele/阿黛尔/阿黛儿", "Adele", "阿黛尔", "阿黛儿"),
        ),
    ],
    ids=[
        "one name",
        "a translation",
        "glued",
        "glued the other way",
        "two artists",
        "a slash of its own",
        "three names",
    ],
)
def test_a_name_is_looked_up_whole_and_by_each_of_its_parts(
    name: str, queries: tuple[str, ...]
) -> None:
    assert queries_for(name) == queries


def test_the_one_artist_going_by_a_part_is_suggested_for_a_name_of_parts() -> None:
    jackson = Candidate(
        Artist("f27ec8db", "Michael Jackson", "Jackson, Michael", "", "US"), 100, ()
    )

    assert suggested("Michael Jackson/迈克尔·杰克逊", [jackson]) == "f27ec8db"


def test_parts_going_by_two_artists_suggest_neither() -> None:
    miku = Candidate(Artist("a1", "初音ミク", "", "", "JP"), 100, ())
    other = Candidate(Artist("b2", "米津玄師", "", "", "JP"), 100, ())

    assert suggested("初音ミク/米津玄師", [miku, other]) is None
