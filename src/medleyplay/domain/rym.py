r"""Reading the file a member downloads from their own Rate Your Music profile.

Rate Your Music rates releases, so the export is a list of albums, each with the
member's rating out of 10 and their review. Its format is no published contract;
this reader follows a 2020 export:

    RYM Album, First Name,Last Name,First Name localized, Last Name localized,Title,...
    "1001","","\u{30cf}\u{30c1}","","Hachi","Bremen","2015","9","n","","",  ""

Text outside ASCII is written as `\u{...}` escapes and `&` as `&amp;`. The artist's
name is split in two (*Tony* and *Allen*), and a name in another script comes with a
localized one (*ハチ* and *Hachi*).
"""

# cspell:ignore Hachi

import csv
import html
import io
import re
import unicodedata
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from typing import Final

from medleyplay.domain.errors import InvalidInputError, TooLargeError

MAX_EXPORT_BYTES: Final = 5 * 1024 * 1024
MAX_EXPORT_ROWS: Final = 20_000
MAX_FIELD_LENGTH: Final = 10_000
MAX_RYM_RATING: Final = 10

COLUMNS: Final = (
    "RYM Album",
    "First Name",
    "Last Name",
    "First Name localized",
    "Last Name localized",
    "Title",
    "Release_Date",
    "Rating",
    "Ownership",
    "Purchase Date",
    "Media Type",
    "Review",
)
"""The export's columns in order, each without the spaces some carry before it."""

_ESCAPE: Final = re.compile(r"\\u\{([0-9a-fA-F]{0,8})\}")
_LAST_CHARACTER: Final = 0x10FFFF
_SURROGATES: Final = range(0xD800, 0xE000)
_DIRECTION: Final = frozenset(
    "\u061c\u200e\u200f\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069"
)
"""The characters that reorder the text around them."""
_REMOVED_CATEGORIES: Final = frozenset({"Cc", "Zl", "Zp"})


@dataclass(frozen=True)
class RymAlbum:
    """One album as a member rated it on Rate Your Music.

    `artist` is the name as the site shows it, and `artist_localized` the same name in
    Latin letters, or blank. `stars` are the rating out of 5, or `None` for an album
    reviewed but not rated; `note` is the review.
    """

    rym_id: str
    artist: str
    artist_localized: str
    album: str
    stars: int | None
    note: str = ""


def read_rym_export(data: bytes) -> tuple[RymAlbum, ...]:
    """Return the albums an export rated or reviewed, in the export's order.

    An album neither rated nor reviewed is left out. A file over its limits, not
    UTF-8, with a header this reader doesn't know, or with a value it can't read is
    refused, naming what is wrong and on which line.
    """
    if len(data) > MAX_EXPORT_BYTES:
        message = f"A Rate Your Music export is at most {MAX_EXPORT_BYTES // (1024 * 1024)} MiB."
        raise TooLargeError(message)
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        message = (
            "A Rate Your Music export is UTF-8 text; this file isn't, "
            "so it may have been saved again as UTF-16 or from a spreadsheet."
        )
        raise InvalidInputError(message) from None
    reader = csv.reader(io.StringIO(text, newline=""), skipinitialspace=True, strict=True)
    try:
        _check_header(next(reader, None))
        return tuple(_albums_of(reader, lambda: reader.line_num))
    except csv.Error as error:
        message = f"The export can't be read on line {reader.line_num}: {error}."
        raise InvalidInputError(message) from None


def stars_of(rating: str, *, line: int) -> int | None:
    """Return a 0-10 rating as stars out of 5, halves rounded up; 0 is no rating."""
    if not (rating.isascii() and rating.isdecimal()) or int(rating) > MAX_RYM_RATING:
        message = f"The rating on line {line} is {rating!r}; a rating is 0-10."
        raise InvalidInputError(message)
    return None if int(rating) == 0 else (int(rating) + 1) // 2


def _check_header(header: list[str] | None) -> None:
    if header is None:
        message = "The file has no header; a Rate Your Music export starts with its columns."
        raise InvalidInputError(message)
    names = [name.strip() for name in header]
    for index, expected in enumerate(COLUMNS):
        found = names[index] if index < len(names) else None
        if found != expected:
            message = (
                f"The export's column {index + 1} is {found!r}, not {expected!r}; "
                "this isn't a Rate Your Music export this server can read."
            )
            raise InvalidInputError(message)
    if len(names) > len(COLUMNS):
        message = f"The export has a column {names[len(COLUMNS)]!r} this server doesn't know."
        raise InvalidInputError(message)


def _albums_of(rows: Iterator[list[str]], line_of: Callable[[], int]) -> Iterator[RymAlbum]:
    count = 0
    for fields in rows:
        if not fields:
            continue
        count += 1
        if count > MAX_EXPORT_ROWS:
            message = f"A Rate Your Music export has at most {MAX_EXPORT_ROWS} albums."
            raise TooLargeError(message)
        line = line_of()
        if len(fields) != len(COLUMNS):
            message = f"There are {len(fields)} values on line {line}, not {len(COLUMNS)}."
            raise InvalidInputError(message)
        values = dict(zip(COLUMNS, fields, strict=True))
        name = {column: _text_of(values[column], line=line) for column in COLUMNS[:6]}
        album = RymAlbum(
            rym_id=name["RYM Album"],
            artist=_joined(name["First Name"], name["Last Name"]),
            artist_localized=_joined(name["First Name localized"], name["Last Name localized"]),
            album=name["Title"],
            stars=stars_of(values["Rating"].strip(), line=line),
            note=_text_of(values["Review"], line=line, lines=True),
        )
        if album.stars is not None or album.note:
            yield album


def _text_of(field: str, *, line: int, lines: bool = False) -> str:
    """Return a value as plain text: escapes and entities undone, control characters gone.

    Line breaks and tabs stay where `lines`, and become spaces otherwise.
    """
    if len(field) > MAX_FIELD_LENGTH:
        message = f"A value on line {line} is over {MAX_FIELD_LENGTH} characters."
        raise InvalidInputError(message)

    def character(match: re.Match[str]) -> str:
        digits = match.group(1)
        point = int(digits, 16) if digits else -1
        if not 0 <= point <= _LAST_CHARACTER or point in _SURROGATES:
            message = f"There is {match.group(0)!r} on line {line}, which names no character."
            raise InvalidInputError(message)
        return chr(point)

    text = html.unescape(_ESCAPE.sub(character, field))
    if not lines:
        text = text.replace("\n", " ").replace("\t", " ")
    kept = (
        each
        for each in text
        if each in "\n\t"
        or (each not in _DIRECTION and unicodedata.category(each) not in _REMOVED_CATEGORIES)
    )
    return "".join(kept).strip()


def _joined(first: str, last: str) -> str:
    return f"{first} {last}".strip()
