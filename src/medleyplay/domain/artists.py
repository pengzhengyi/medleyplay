"""One artist under many names: the artists a site knows by a name, and which to link it to.

Songs keep the name as written. A written name is linked to one artist a site knows,
here MusicBrainz, so that *The Beatles*, *披头士*, and *甲壳虫* can count as one artist:

```text
披头士    → The Beatles (b10bbbfc-…), going by Beatles, 披头士, 披頭四
甲壳虫    → The Beatles
Various Artists, 群星    never looked up: they name no one artist
周杰伦2000年发行首张个人   tidied first, so the name is looked up and not the note
```

A name written as several, such as *Michael Jackson/迈克尔·杰克逊* or *Adele阿黛尔*, is
looked up whole and by each part, as a name with a translation, or the names of a
collaboration, is written. A link is only suggested, and the household chooses it:
the one artist going by the whole name exactly, as its name, sort name, or an alias,
and scored high by the site; or else the one going by a part, when no other does.
"""

import re
from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Final

from medleyplay.domain.rules import fold
from medleyplay.domain.tidy import tidy_artist

MAX_QUERIES: Final = 4
"""The most searches one name is looked up with: whole, then by its parts."""
MIN_SLASHED_LATIN: Final = 3
"""The least length of each Latin part for a slash to divide a name, so *AC/DC* stays one."""
MIN_GLUED: Final = 2
"""The least length of each side of a Latin name glued to a Chinese or Japanese one."""
_SLASH: Final = re.compile(r"\s*[/\uff0f]\s*")
_GLUED: Final = re.compile(
    r"(?<=[A-Za-z.])(?=[\u3040-\u30ff\u3400-\u9fff])|(?<=[\u3040-\u30ff\u3400-\u9fff])(?=[A-Za-z])"
)
SUGGESTED_SCORE: Final = 90
"""The least score of the site's for a match to be suggested."""
NO_ONE: Final = frozenset(
    fold(name)
    for name in (
        "Various Artists",
        "Various",
        "V.A.",
        "VA",
        "Unknown",
        "Unknown Artist",
        "群星",
        "佚名",
        "未知",
        "未知艺术家",
        "未知歌手",
        "オムニバス",
    )
)
"""Names that stand for no one artist, which are never looked up."""


@dataclass(frozen=True)
class Artist:
    """An artist a site knows: its id there, its name, and what tells it apart."""

    id: str
    name: str
    sort_name: str
    disambiguation: str
    country: str


@dataclass(frozen=True)
class Alias:
    """Another name an artist goes by, and the language it is written for, if one."""

    name: str
    locale: str | None = None
    primary: bool = False


@dataclass(frozen=True)
class Candidate:
    """An artist a site knows by a name, how well it matches, and its other names."""

    artist: Artist
    score: int
    aliases: tuple[Alias, ...]

    def goes_by(self, name: str) -> bool:
        """Return whether the artist goes by `name`: its name, sort name, or an alias."""
        key = artist_key(name)
        names = (self.artist.name, self.artist.sort_name, *(alias.name for alias in self.aliases))
        return any(artist_key(each) == key for each in names if each)


class LookUp(StrEnum):
    """Whether a name may be looked up."""

    YES = "yes"
    NEVER = "never"
    """It names no one artist."""
    TIDY_FIRST = "tidy_first"
    """It has more than the name in it; tidied, its name is looked up instead."""


def artist_key(name: str) -> str:
    """Return the form names are kept and compared by: trimmed and folded."""
    return fold(name.strip())


def may_look_up(name: str) -> LookUp:
    """Return whether `name` may be looked up on a site."""
    if not name.strip() or artist_key(name) in NO_ONE:
        return LookUp.NEVER
    return LookUp.YES if tidy_artist(name) is None else LookUp.TIDY_FIRST


def queries_for(name: str) -> tuple[str, ...]:
    """Return what `name` is looked up by: itself, then each of its parts, if it has any."""
    whole = name.strip()
    return tuple(dict.fromkeys((whole, *_parts(whole))))[:MAX_QUERIES]


def suggested(name: str, candidates: Sequence[Candidate]) -> str | None:
    """Return the id of the artist to suggest for `name`, if just one fits.

    The one artist scored high going by the whole name exactly; else, for a name of
    parts, the one going by any of them.
    """
    high = [each for each in candidates if each.score >= SUGGESTED_SCORE]
    whole = {each.artist.id for each in high if each.goes_by(name)}
    if whole:
        return next(iter(whole)) if len(whole) == 1 else None
    by_part = {each.artist.id for each in high for part in _parts(name) if each.goes_by(part)}
    return next(iter(by_part)) if len(by_part) == 1 else None


def _parts(name: str) -> tuple[str, ...]:
    """Return the names a name is written as, divided by slashes or where scripts meet."""
    slashed = [part for part in _SLASH.split(name.strip()) if part]
    latin_only = all(part.isascii() for part in slashed)
    if (
        len(slashed) == 1
        or any(len(part) < MIN_GLUED for part in slashed)
        or (latin_only and any(len(part) < MIN_SLASHED_LATIN for part in slashed))
    ):
        slashed = [name.strip()]
    parts: list[str] = []
    for each in slashed:
        glued = [side.strip() for side in _GLUED.split(each) if side.strip()]
        if len(glued) > 1 and all(len(side) >= MIN_GLUED for side in glued):
            parts.extend(glued)
        else:
            parts.append(each)
    return () if parts == [name.strip()] else tuple(parts)
