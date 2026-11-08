"""Reading a Rate Your Music export: its albums, their stars, and the reviews written on them."""

import pytest

from medleyplay.domain.errors import InvalidInputError, TooLargeError
from medleyplay.domain.rym import (
    MAX_EXPORT_BYTES,
    MAX_EXPORT_ROWS,
    MAX_FIELD_LENGTH,
    RymAlbum,
    read_rym_export,
    stars_of,
)
from tests.support.rym import EXPORT_2020, HEADER, export_of, row


def test_a_2020_export_reads_as_its_rated_albums() -> None:
    albums = read_rym_export(EXPORT_2020.encode())

    assert albums == (
        RymAlbum(rym_id="1001", artist="ハチ", artist_localized="Hachi", album="Bremen", stars=5),
        RymAlbum(
            rym_id="1002",
            artist="Tony Allen",
            artist_localized="",
            album="Film of Life",
            stars=4,
            note="Warm & loose.",
        ),
        RymAlbum(rym_id="1004", artist="スズム", artist_localized="Suzumu", album="八日", stars=1),
    )


@pytest.mark.parametrize(
    ("rating", "stars"),
    [("1", 1), ("2", 1), ("3", 2), ("6", 3), ("7", 4), ("9", 5), ("10", 5), ("0", None)],
)
def test_half_stars_round_half_up_and_0_is_no_rating(rating: str, stars: int | None) -> None:
    assert stars_of(rating, line=2) == stars


@pytest.mark.parametrize("rating", ["11", "-1", "7.5", "", "seven"])
def test_a_rating_outside_0_to_10_is_refused_naming_its_line(rating: str) -> None:
    with pytest.raises(InvalidInputError, match="line 2"):
        read_rym_export(export_of(row(rating=rating)))


def test_an_unrated_album_with_a_review_keeps_the_review() -> None:
    albums = read_rym_export(export_of(row(rating="0", review="Never finished it.")))

    assert albums == (
        RymAlbum(
            rym_id="1",
            artist="Artist",
            artist_localized="",
            album="Album",
            stars=None,
            note="Never finished it.",
        ),
    )


def test_the_first_and_last_names_join_into_the_artist() -> None:
    albums = read_rym_export(
        export_of(row(first="Tha", last="Alkaholiks", first_localized="A", last_localized="B"))
    )

    assert (albums[0].artist, albums[0].artist_localized) == ("Tha Alkaholiks", "A B")


def test_html_entities_and_surrounding_spaces_are_undone() -> None:
    albums = read_rym_export(export_of(row(last="Jaime &amp; Nair", title=" Jaime &lt;3 ")))

    assert (albums[0].artist, albums[0].album) == ("Jaime & Nair", "Jaime <3")


def test_control_and_direction_characters_are_removed_and_line_breaks_kept() -> None:
    review = "Side A\u202e\nSide B\x07"

    albums = read_rym_export(export_of(row(title="\\u{202e}Album\\u{0}", review=review)))

    assert (albums[0].album, albums[0].note) == ("Album", "Side A\nSide B")


@pytest.mark.parametrize("escape", ["\\u{d800}", "\\u{110000}", "\\u{}"])
def test_an_escape_that_names_no_character_is_refused_naming_its_line(escape: str) -> None:
    with pytest.raises(InvalidInputError, match="line 2"):
        read_rym_export(export_of(row(title=f"Album {escape}")))


def test_a_byte_order_mark_is_dropped() -> None:
    albums = read_rym_export(b"\xef\xbb\xbf" + export_of(row()))

    assert len(albums) == 1


def test_an_export_that_is_not_utf_8_is_refused() -> None:
    with pytest.raises(InvalidInputError, match="UTF-8"):
        read_rym_export(export_of(row(title="Caf\xe9")).replace(b"\xc3\xa9", b"\xe9"))


def test_an_unknown_header_is_refused_naming_the_first_column_not_known() -> None:
    renamed = export_of(row()).replace(b"Media Type", b"Format")

    with pytest.raises(InvalidInputError, match="'Format'"):
        read_rym_export(renamed)


def test_an_empty_file_is_refused() -> None:
    with pytest.raises(InvalidInputError, match="no header"):
        read_rym_export(b"")


def test_a_row_with_another_number_of_columns_is_refused_naming_its_line() -> None:
    with pytest.raises(InvalidInputError, match="line 3"):
        read_rym_export(export_of(row(), '"2","","Artist","","","Album","2020","8"'))


def test_a_blank_line_is_skipped() -> None:
    albums = read_rym_export(export_of(row(), "", row(rym_id="2")))

    assert [album.rym_id for album in albums] == ["1", "2"]


def test_an_export_over_its_size_is_refused() -> None:
    with pytest.raises(TooLargeError, match="5 MiB"):
        read_rym_export(export_of(row()) + b" " * MAX_EXPORT_BYTES)


def test_an_export_over_its_rows_is_refused() -> None:
    with pytest.raises(TooLargeError, match="20000"):
        read_rym_export(export_of(*[row()] * (MAX_EXPORT_ROWS + 1)))


def test_a_value_over_its_length_is_refused_naming_its_line() -> None:
    with pytest.raises(InvalidInputError, match="line 2"):
        read_rym_export(export_of(row(review="x" * (MAX_FIELD_LENGTH + 1))))


def test_an_export_of_only_the_header_has_no_albums() -> None:
    assert read_rym_export(f"{HEADER}\n".encode()) == ()


def test_an_export_at_its_rows_reads_every_album() -> None:
    albums = read_rym_export(export_of(*[row()] * MAX_EXPORT_ROWS))

    assert len(albums) == MAX_EXPORT_ROWS


def test_a_quote_left_open_is_refused_naming_its_line() -> None:
    with pytest.raises(InvalidInputError, match="line"):
        read_rym_export(export_of(row(), '"2","","Artist'))


def test_windows_line_endings_read_as_the_same_albums() -> None:
    export = export_of(row(review="Side A\nSide B"), row(rym_id="2"))

    albums = read_rym_export(export.replace(b"\n", b"\r\n"))

    assert [album.note for album in albums] == ["Side A\nSide B", ""]


def test_a_review_over_several_lines_keeps_them_and_a_title_does_not() -> None:
    albums = read_rym_export(export_of(row(title="Side\nA", review="One\n\tTwo")))

    assert (albums[0].album, albums[0].note) == ("Side A", "One\n\tTwo")


@pytest.mark.parametrize(
    ("written", "read"),
    [("Al\x00bum", "Album"), ("Al\\u{2028}bum", "Album"), ("Al&#0;bum", "Al\ufffdbum")],
)
def test_a_character_that_hides_text_is_removed_or_shown_as_unknown(
    written: str, read: str
) -> None:
    albums = read_rym_export(export_of(row(title=written)))

    assert albums[0].album == read
