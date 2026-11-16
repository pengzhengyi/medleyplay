"""Splitting a name written as several artists: which names to offer, and into what."""

import pytest

from medleyplay.domain.artist_split import Credit, Role, split_suggestion


def _main(*names: str) -> tuple[Credit, ...]:
    return tuple(Credit(name, Role.MAIN) for name in names)


def _featured(*names: str) -> tuple[Credit, ...]:
    return tuple(Credit(name, Role.FEATURED) for name in names)


@pytest.mark.parametrize(
    ("written", "listed"),
    [
        ("GUMI/MAYU", _main("GUMI", "MAYU")),
        ("初音ミク / 米津玄師", _main("初音ミク", "米津玄師")),
        ("周杰伦、费玉清", _main("周杰伦", "费玉清")),
        ("周杰伦，费玉清", _main("周杰伦", "费玉清")),  # noqa: RUF001 -- full-width comma
        ("Blue Room; Night Drive", _main("Blue Room", "Night Drive")),
        ("Daft Punk x Radiohead", _main("Daft Punk", "Radiohead")),
        ("米津玄師 × 菅田将暉", _main("米津玄師", "菅田将暉")),  # noqa: RUF001 -- as written
    ],
)
def test_a_name_listing_several_artists_is_offered_as_each_of_them(
    written: str, listed: tuple[Credit, ...]
) -> None:
    assert split_suggestion(written) == listed


@pytest.mark.parametrize(
    ("written", "listed"),
    [
        ("スズム feat. GUMI", _main("スズム") + _featured("GUMI")),
        ("Calvin Harris ft. Radiohead", _main("Calvin Harris") + _featured("Radiohead")),
        ("Daft Punk featuring Blue Room", _main("Daft Punk") + _featured("Blue Room")),
        ("DECO*27 (feat. 初音ミク)", _main("DECO*27") + _featured("初音ミク")),
        ("スズム（feat. GUMI, MAYU）", _main("スズム") + _featured("GUMI", "MAYU")),  # noqa: RUF001
        ("A FEAT. B & C", _main("A") + _featured("B", "C")),
        ("GUMI/MAYU feat. Lily", _main("GUMI", "MAYU") + _featured("Lily")),
    ],
)
def test_an_artist_featuring_others_is_offered_as_its_main_artists_and_the_featured(
    written: str, listed: tuple[Credit, ...]
) -> None:
    assert split_suggestion(written) == listed


@pytest.mark.parametrize(
    "written",
    [
        "AC/DC",
        "Simon & Garfunkel",
        "Earth, Wind & Fire",
        "Michael Jackson/迈克尔·杰克逊",
        "Radiohead/レディオヘッド",
        "Adele阿黛尔",
        "Various Artists",
        "群星",
        "Radiohead",
        "",
        "feat. GUMI",
        "GUMI/",
        "GUMI/gumi",
    ],
)
def test_a_name_naming_one_artist_or_no_one_is_not_offered(written: str) -> None:
    assert split_suggestion(written) is None
