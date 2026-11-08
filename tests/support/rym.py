"""Rate Your Music exports, in the shape of a 2020 export: its header and how it writes values.

The rows are made up for these tests; the header, the quoting, the `\\u{...}` escapes,
the HTML entities, and the spaces before the review are as the 2020 export writes them.
"""

# cspell:ignore Hachi Suzumu

from typing import Final

HEADER: Final = (
    "RYM Album, First Name,Last Name,First Name localized, Last Name localized,Title,"
    "Release_Date,Rating,Ownership,Purchase Date,Media Type,Review"
)
"""The first line of a 2020 export, two of whose names start with a space."""

EXPORT_2020: Final = (
    HEADER
    + "\n"
    + r"""
"1001","","\u{30cf}\u{30c1}","","Hachi","Bremen","2015","9","n","","",  ""
"1002","Tony","Allen","","","Film of Life","2014","7","o","","CD",  "Warm &amp; loose."
"1003","","\u{ae40}\u{c815}\u{bbf8}","","Kim Jung Mi","Now ","1973","0","n","","",  ""
"1004","","\u{30b9}\u{30ba}\u{30e0}","","Suzumu","\u{516b}\u{65e5}","2016","1","w","","",  ""
""".lstrip("\n")
)
"""Four albums, as a 2020 export writes them.

    ハチ (Hachi), Bremen: 9, so 5 stars
    Tony Allen, Film of Life: 7, so 4 stars, reviewed "Warm & loose."
    김정미 (Kim Jung Mi), Now: 0, unrated and unreviewed, so left out
    スズム (Suzumu), 八日: 1, so 1 star
"""


def export_of(*rows: str) -> bytes:
    """Return a 2020-shaped export of `rows`, each a line as the export writes it."""
    return (HEADER + "\n" + "".join(f"{row}\n" for row in rows)).encode()


def row(  # noqa: PLR0913 -- one argument per column a test varies
    *,
    rym_id: str = "1",
    first: str = "",
    last: str = "Artist",
    first_localized: str = "",
    last_localized: str = "",
    title: str = "Album",
    rating: str = "8",
    review: str = "",
) -> str:
    """Return one line of an export, every value quoted as the export quotes it."""
    values = [rym_id, first, last, first_localized, last_localized, title, "2020", rating]
    values += ["n", "", ""]
    quoted = ",".join(f'"{value}"' for value in values)
    return f'{quoted},  "{review}"'
