import pytest

from medleyplay.domain.tidy import Tidied, tidy_artist


@pytest.mark.parametrize(
    ("written", "expected"),
    [
        ("周杰伦2000年发行首张个人", Tidied("周杰伦", 2000)),
        ("周杰伦2006年发行EP", Tidied("周杰伦", 2006)),
        ("The Beatles（披头士）2000年发行", Tidied("The Beatles", 2000)),  # noqa: RUF001 -- full-width brackets
        ("周杰伦 2001年", Tidied("周杰伦", 2001)),
        ("五月天 1999年發行", Tidied("五月天", 1999)),
    ],
    ids=["first album", "an EP", "a translation, then the year", "the year alone", "traditional"],
)
def test_a_release_year_ends_the_name_and_is_kept(written: str, expected: Tidied) -> None:
    assert tidy_artist(written) == expected


@pytest.mark.parametrize(
    ("written", "expected"),
    [
        ("朴树2003", Tidied("朴树", 2003)),
        ("周杰伦 2001", Tidied("周杰伦", 2001)),
    ],
    ids=["glued", "after a space"],
)
def test_a_year_glued_to_a_name_or_after_a_non_latin_letter_is_taken_off(
    written: str, expected: Tidied
) -> None:
    assert tidy_artist(written) == expected


@pytest.mark.parametrize(
    ("written", "name"),
    [
        ("The Beatles（披头士）", "The Beatles"),  # noqa: RUF001 -- full-width brackets
        ("The Beatles (披头士)", "The Beatles"),
        ("初音ミク(Hatsune Miku)", "初音ミク"),
        ("周杰伦 (Live)", "周杰伦"),
        ("ヨルシカ\uff08Yorushika/夜鹿\uff09", "ヨルシカ"),
    ],
    ids=[
        "full-width brackets",
        "half-width brackets",
        "a Latin name in brackets",
        "a note",
        "names in both scripts",
    ],
)
def test_a_bracketed_part_in_another_script_is_taken_off(written: str, name: str) -> None:
    assert tidy_artist(written) == Tidied(name, None)


@pytest.mark.parametrize(
    "written",
    [
        "The 1975",
        "Sum 41",
        "Blink-182",
        "2NE1",
        "5 Seconds of Summer",
        "f(x)",
        "ryo(supercell)",
        "Mr.Children",
        "S.H.E",
        "Earth, Wind & Fire",
        "AC/DC",
        "初音ミク/米津玄師",
        "Various Artists",
        "群星",
        "",
    ],
)
def test_a_name_with_nothing_to_tidy_is_left_as_it_is(written: str) -> None:
    assert tidy_artist(written) is None


def test_a_name_that_would_be_left_empty_is_left_as_it_is() -> None:
    assert tidy_artist("2000年发行") is None


def test_a_decade_is_not_a_release_year() -> None:
    assert tidy_artist("2000年代金曲") is None
