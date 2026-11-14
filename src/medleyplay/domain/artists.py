"""One artist under many names: the artists a site knows by a name, and which to link it to.

Songs keep the name as written. A written name is linked to one artist a site knows,
here MusicBrainz, so that *The Beatles*, *披头士*, and *甲壳虫* can count as one artist:

```text
披头士    → The Beatles (b10bbbfc-…), going by Beatles, 披头士, 披頭四
甲壳虫    → The Beatles
Various Artists, 群星    never looked up: they name no one artist
周杰伦2000年发行首张个人   tidied first, so the name is looked up and not the note
```

A link is only suggested, and the household chooses it: the one artist going by the
name exactly, as its name, sort name, or an alias, and scored high by the site.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Final

from medleyplay.domain.rules import fold
from medleyplay.domain.tidy import tidy_artist

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


def suggested(name: str, candidates: Sequence[Candidate]) -> str | None:
    """Return the id of the one artist going by `name` exactly and scored high, if just one."""
    fits = {
        each.artist.id
        for each in candidates
        if each.score >= SUGGESTED_SCORE and each.goes_by(name)
    }
    return next(iter(fits)) if len(fits) == 1 else None
