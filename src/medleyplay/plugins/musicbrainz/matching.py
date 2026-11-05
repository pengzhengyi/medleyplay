"""Choosing the release a Track is on: the search queries, and how the candidates are ranked.

A recording is on many releases, so a search answers each recording with every
release it appears on. The best candidate is the one with the highest score; among
equals, the release named like the Track's album, then an official release, then the
earliest, which is the original pressing rather than a reissue:

```text
Let Down, album OK Computer
  OK Computer  1997-05-21  Official   chosen: named, official, earliest
  OK Computer  2016-05-01  Official   a reissue
  The Best Of  2008-05-28  Official   another album
```
"""

import re
import unicodedata
from dataclasses import dataclass
from typing import Final

MIN_SCORE: Final = 90
"""The least search score (0 to 100) of a candidate."""
LENGTH_WINDOW_MS: Final = 5_000
"""How far a recording's length may differ from the Track's, when both are known."""

_LUCENE_SYNTAX: Final = re.compile(r'([+\-&|!(){}\[\]^"~*?:\\/])')
_DATE: Final = re.compile(r"(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?")
_LATEST: Final = (9999, 13, 32)


def escape_lucene(text: str) -> str:
    """Return `text` with every character the Lucene query parser reads as syntax escaped."""
    return _LUCENE_SYNTAX.sub(r"\\\1", text)


def recording_query(title: str, artist: str, album: str | None = None) -> str:
    """Return the query for a recording by `title` and `artist`, on `album` when it is known.

    ```text
    recording:"Let Down" AND artist:"Radiohead" AND release:"OK Computer"
    ```
    """
    parts = [f'recording:"{escape_lucene(title)}"', f'artist:"{escape_lucene(artist)}"']
    if album:
        parts.append(f'release:"{escape_lucene(album)}"')
    return " AND ".join(parts)


def release_query(album: str, artist: str) -> str:
    """Return the query for a release called `album` by `artist`.

    ```text
    release:"生如夏花" AND artist:"朴树"
    ```
    """
    return f'release:"{escape_lucene(album)}" AND artist:"{escape_lucene(artist)}"'


def same_title(first: str, second: str) -> bool:
    """Return whether two titles are the same ignoring case and the width of characters."""
    return _folded(first) == _folded(second)


def _folded(text: str) -> str:
    return unicodedata.normalize("NFKC", text).casefold().strip()


def within_window(wanted_ms: int | None, found_ms: int | None) -> bool:
    """Return whether a recording's length is near the Track's; unknown lengths always are."""
    if wanted_ms is None or found_ms is None:
        return True
    return abs(wanted_ms - found_ms) <= LENGTH_WINDOW_MS


@dataclass(frozen=True)
class Candidate:
    """One release a search found, and the recording on it when a recording was searched."""

    release: str
    """The release's id."""
    title: str
    """The release's title."""
    score: int
    official: bool
    date: str | None
    recording: str | None = None
    """The id of the recording, or `None` when releases were searched."""


def best(candidates: list[Candidate], album: str | None) -> Candidate | None:
    """Return the best candidate scoring at least `MIN_SCORE`, or `None` when none does."""
    passing = [each for each in candidates if each.score >= MIN_SCORE]
    if not passing:
        return None
    return min(passing, key=lambda each: _rank(each, album))


def _rank(candidate: Candidate, album: str | None) -> tuple[int, bool, bool, tuple[int, int, int]]:
    named = album is not None and same_title(album, candidate.title)
    return (-candidate.score, not named, not candidate.official, _date_key(candidate.date))


def _date_key(date: str | None) -> tuple[int, int, int]:
    """Return a date as year, month, day, where a part the date lacks sorts after its peers."""
    found = _DATE.fullmatch(date or "")
    if found is None:
        return _LATEST
    year, month, day = found.groups()
    return (int(year), int(month or 13), int(day or 32))
