"""What listeners on other sites rated a song or its album, shown where an Account gave none.

A site's listeners rate a song, and the album it is on. A song shows its own rating
when enough listeners gave one, else its album's, else none:

```text
song 4.2 from 24 votes, album 4.55 from 89   shows the song's 4.2
song 5 from 2 votes, album 3.5 from 12       shows the album's 3.5
song 5 from 2 votes                          shows none
```

A community rating only shows: smart-playlist rules, the download policy, and
recommendations read the Account's own rating alone.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from enum import StrEnum
from typing import Final
from urllib.parse import urlsplit

MIN_VOTES: Final = 3
"""The fewest listeners whose rating a song shows; fewer say little about it."""


class RatedAs(StrEnum):
    """What listeners rated: the song itself, or the album it is on."""

    SONG = "song"
    ALBUM = "album"


@dataclass(frozen=True)
class CommunityRating:
    """What listeners on `source` rated a song or its album, out of 5, and the page saying so."""

    source: str
    of: RatedAs
    value: float
    votes: int
    link: str


def shown_rating(ratings: Iterable[CommunityRating]) -> CommunityRating | None:
    """Return the rating a song shows: its own, else its album's, from enough listeners."""
    enough = [rating for rating in ratings if rating.votes >= MIN_VOTES]
    for of in (RatedAs.SONG, RatedAs.ALBUM):
        rated = [rating for rating in enough if rating.of is of]
        if rated:
            return max(rated, key=lambda rating: rating.votes)
    return None


def link_is_on(link: str, hosts: frozenset[str]) -> bool:
    """Return whether `link` is an `https` link to one of `hosts`, and nowhere else."""
    try:
        parts = urlsplit(link)
    except ValueError:
        return False
    host = (parts.hostname or "").lower()
    return parts.scheme == "https" and "@" not in parts.netloc and host in hosts
