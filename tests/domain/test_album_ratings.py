"""Finding a Library album's rating among an Account's rated albums, and a song's from it."""

import pytest

from medleyplay.domain.album_ratings import (
    AlbumRatings,
    LibraryAlbums,
    RatedAlbum,
    edition_removed,
    effective_rating,
)


def rated(artist: str, album: str, stars: int | None = 4, *, localized: str = "") -> RatedAlbum:
    return RatedAlbum.of(artist=artist, artist_localized=localized, album=album, stars=stars)


def test_an_album_matches_by_its_artist_and_name_folded() -> None:
    ratings = AlbumRatings([rated("ﾊﾁ", "BREMEN", 5)])

    assert ratings.stars_of("ハチ", "Bremen") == 5


def test_an_album_matches_by_the_artists_localized_name() -> None:
    ratings = AlbumRatings([rated("김정미", "Now", 3, localized="Kim Jung Mi")])

    assert ratings.stars_of("kim jung mi", "Now") == 3


def test_an_album_by_another_artist_does_not_match() -> None:
    ratings = AlbumRatings([rated("ハチ", "Bremen")])

    assert ratings.stars_of("米津玄師", "Bremen") is None


@pytest.mark.parametrize(("artist", "album"), [("", "Bremen"), ("ハチ", ""), ("", "")])
def test_an_album_with_a_blank_name_or_artist_has_no_rating(artist: str, album: str) -> None:
    ratings = AlbumRatings([rated("ハチ", "Bremen"), rated("", "", 5)])

    assert ratings.stars_of(artist, album) is None


def test_an_edition_note_is_set_aside_on_both_sides_when_nothing_matches_exactly() -> None:
    ratings = AlbumRatings([rated("スズム", "八日目、雨が止む前に。 (Deluxe Edition)", 2)])

    assert ratings.stars_of("スズム", "八日目、雨が止む前に。(初回限定盤B)") == 2


def test_an_exact_match_wins_over_an_edition_set_aside() -> None:
    ratings = AlbumRatings([rated("A", "Blue (Remastered)", 2), rated("A", "Blue", 5)])

    assert ratings.stars_of("A", "Blue (Remastered)") == 2


def test_of_two_editions_matched_alike_the_higher_rating_counts() -> None:
    ratings = AlbumRatings([rated("A", "Blue (Deluxe)", 2), rated("A", "Blue [Remaster]", 4)])

    assert ratings.stars_of("A", "Blue") == 4


def test_an_album_reviewed_but_not_rated_gives_no_rating_and_its_review() -> None:
    reviewed = RatedAlbum.of(
        artist="A", artist_localized="", album="Blue", stars=None, note="Never finished it."
    )
    ratings = AlbumRatings([reviewed])

    assert (ratings.stars_of("A", "Blue"), ratings.find("A", "Blue")) == (None, reviewed)


def test_an_account_that_rated_no_album_has_no_ratings() -> None:
    assert (bool(AlbumRatings([])), bool(AlbumRatings([rated("A", "Blue")]))) == (False, True)


@pytest.mark.parametrize(
    ("name", "removed"),
    [
        ("Blue (Deluxe Edition)", "Blue"),
        ("Blue [Disc 1]", "Blue"),
        ("Blue (2011 Remaster)", "Blue"),
        ("八日目、雨が止む前に。(初回限定盤B)", "八日目、雨が止む前に。"),
        ("Blue（通常版）", "Blue"),  # noqa: RUF001 -- full-width brackets
        ("Blue (Live)", None),
        ("Blue (Soundtrack)", None),
        ("Enter the Wu-Tang (36 Chambers)", None),
        ("고블린 (Goblin)", None),
        ("(Deluxe Edition)", None),
        ("Blue", None),
    ],
)
def test_only_a_trailing_note_naming_an_edition_is_set_aside(
    name: str, removed: str | None
) -> None:
    assert edition_removed(name) == removed


@pytest.mark.parametrize(
    ("own", "album", "effective"), [(5, 2, 5), (None, 2, 2), (3, None, 3), (None, None, None)]
)
def test_a_songs_own_rating_comes_before_its_albums(
    own: int | None, album: int | None, effective: int | None
) -> None:
    assert effective_rating(own, album) == effective


def test_the_library_has_a_rated_album_matched_exactly_or_with_editions_set_aside() -> None:
    library = LibraryAlbums([("ハチ", "Bremen"), ("スズム", "八日目 (初回限定盤B)"), ("", "Blue")])

    assert [
        library.has(rated("ハチ", "BREMEN")),
        library.has(rated("スズム", "八日目 [Deluxe]")),
        library.has(rated("ハチ", "Diorama")),
        library.has(rated("", "Blue")),
    ] == [True, True, False, False]
