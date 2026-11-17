"""Splitting a name written as several artists into each of them, with its role.

A song's artist is often written as several: a collaboration, or an artist featuring
others. Each is offered as its artists, for the household to split or keep as written:

```text
GUMI/MAYU                  GUMI, MAYU
周杰伦、费玉清              周杰伦, 费玉清
スズム feat. GUMI, MAYU    スズム; featuring GUMI, MAYU
AC/DC, Simon & Garfunkel   one artist each: not offered
Michael Jackson/迈克尔·杰克逊  one artist with its name translated: not offered
```

Offers are cautious, since many a band's name holds `&` or `,`: those divide only the
artists a song features. A slash divides only names in one script, as a name and its
translation are written in two.
"""

import re
from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Final

from medleyplay.domain.artists import MIN_GLUED, MIN_SLASHED_LATIN, NO_ONE, artist_key
from medleyplay.domain.details import MAX_TEXT
from medleyplay.domain.errors import InvalidInputError

_FEATURING: Final = re.compile(
    r"^(?P<main>.*?)\s*[(\[\uff08\u3010]?\s*\b(?:feat\.?|ft\.|featuring)\s+"
    r"(?P<featured>.+?)\s*[)\]\uff09\u3011]?\s*$",
    re.IGNORECASE,
)
_LIST: Final = re.compile(r"\s*[\u3001\uff0c;\uff1b]\s*|\s+[x\u00d7]\s+")
_FEATURED_LIST: Final = re.compile(r"\s*[,&\u3001\uff0c;\uff1b/]\s*|\s+[x\u00d7]\s+")
_SLASH: Final = re.compile(r"\s*[/\uff0f]\s*")
_EAST_ASIAN: Final = re.compile(r"[ᄀ-ᇿ぀-ヿ㐀-鿿가-힯ｦ-ﾟ]")


class Role(StrEnum):
    """How a song credits an artist."""

    MAIN = "main"
    FEATURED = "featured"


@dataclass(frozen=True)
class Credit:
    """One artist a name lists, as written, and how the song credits it."""

    written: str
    role: Role = Role.MAIN


def split_suggestion(written: str) -> tuple[Credit, ...] | None:
    """Return the artists `written` lists, main ones first, or `None` if it names one or no one."""
    whole = written.strip()
    if not whole or artist_key(whole) in NO_ONE:
        return None
    featuring = _FEATURING.match(whole)
    if featuring is None:
        return _credits(_mains(whole), [])
    featured = [part.strip() for part in _FEATURED_LIST.split(featuring["featured"])]
    return _credits(_mains(featuring["main"]), featured)


def _credits(mains: list[str], featured: list[str]) -> tuple[Credit, ...] | None:
    """Return each artist once, by its folded name, or `None` for fewer than two."""
    if not mains or not all(mains) or not all(featured):
        return None
    found: dict[str, Credit] = {}
    for name in mains:
        found.setdefault(artist_key(name), Credit(name, Role.MAIN))
    for name in featured:
        found.setdefault(artist_key(name), Credit(name, Role.FEATURED))
    return tuple(found.values()) if len(found) > 1 else None


def _mains(written: str) -> list[str]:
    """Return the main artists `written` lists, divided by list marks and then by slashes."""
    return [name for listed in _LIST.split(written.strip()) for name in _slashed(listed.strip())]


def _slashed(name: str) -> list[str]:
    """Return the names a slash divides `name` into, if each is one artist's name in one script."""
    parts = _SLASH.split(name)
    if len(parts) == 1 or any(len(part) < MIN_GLUED for part in parts):
        return [name]
    if all(part.isascii() for part in parts) and any(
        len(part) < MIN_SLASHED_LATIN for part in parts
    ):
        return [name]
    if len({_EAST_ASIAN.search(part) is None for part in parts}) > 1:
        return [name]
    return parts


def credited_as(credited: Sequence[Credit]) -> str:
    """Return the artists a song credits as one name: the main ones, then those featured.

    ```text
    GUMI, MAYU                      GUMI & MAYU
    周杰伦, 费玉清, 蔡依林           周杰伦, 费玉清 & 蔡依林
    スズム; featuring GUMI           スズム feat. GUMI
    ```
    """
    main = _listed([credit.written for credit in credited if credit.role is Role.MAIN])
    featured = _listed([credit.written for credit in credited if credit.role is Role.FEATURED])
    return f"{main} feat. {featured}" if featured else main


def _listed(names: Sequence[str]) -> str:
    """Return `names` as a list in words: `A`, `A & B`, or `A, B & C`."""
    if len(names) < 2:  # noqa: PLR2004 -- one name, or none, is listed as itself
        return "".join(names)
    return f"{', '.join(names[:-1])} & {names[-1]}"


MAX_CREDITS: Final = 10
"""The most artists the household may choose for one song."""


def checked_credits(credited: Sequence[Credit]) -> tuple[Credit, ...]:
    """Return the artists chosen for a song, trimmed, the main ones first in their order.

    Refused unless there are 1 to `MAX_CREDITS`, at least one main, each named in at
    most `MAX_TEXT` characters, and no artist named twice.
    """
    trimmed = tuple(Credit(credit.written.strip(), credit.role) for credit in credited)
    keys = [artist_key(credit.written) for credit in trimmed]
    if not trimmed or len(trimmed) > MAX_CREDITS:
        message = f"Choose 1 to {MAX_CREDITS} artists."
        raise InvalidInputError(message)
    if any(not credit.written or len(credit.written) > MAX_TEXT for credit in trimmed):
        message = f"Name each artist in 1 to {MAX_TEXT} characters."
        raise InvalidInputError(message)
    if len(set(keys)) < len(keys):
        message = "Name each artist once."
        raise InvalidInputError(message)
    if all(credit.role is Role.FEATURED for credit in trimmed):
        message = "Choose at least one main artist."
        raise InvalidInputError(message)
    return tuple(sorted(trimmed, key=lambda credit: credit.role is Role.FEATURED))
