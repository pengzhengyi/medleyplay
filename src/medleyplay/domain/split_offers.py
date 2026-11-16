"""Split offers: the song list a long file may be split by, and whether it can be trusted.

A file's list comes from its video's text, or from an AI model asked about that text.
When both list the songs, they agree if they count the same songs and each starts
within a few seconds of the other's; titles are not compared, since a model tidies and
translates them. The video's list is the one offered whenever there is one.

```text
video  0:00 Intro · 4:02 Night Drive · 9:30 Encore
AI     0:00 Intro · 4:00 Night Drive · 9:31 Encore     agree: offered from both, trusted
AI     0:00 Intro · 9:30 Encore                         differ: offered from the video, doubted
```

A list is trusted when both agree, or when one alone raises no doubt: no song so long
it may be two, and not so few songs that one may be missing. A list that could not be
saved, or measured against a file of unknown length, is never trusted.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Final

from medleyplay.domain.errors import InvalidInputError
from medleyplay.domain.video_text import MIN_SONG_MS, Song, check_songs

AGREE_MS: Final = 3_000
"""How far apart two lists' starts of one song may be while the lists agree."""
LONG_SONG_MS: Final = 15 * 60_000
"""A song this long is likely two."""
LONG_AVERAGE_MS: Final = 12 * 60_000
"""An album whose songs are this long on average likely misses one."""


class OfferSource(StrEnum):
    """Who listed the songs offered."""

    BOTH = "both"
    VIDEO = "video"
    AI = "ai"


class Doubt(StrEnum):
    """What makes a list offered doubtful."""

    LISTS_DIFFER = "lists_differ"
    """The video and the AI count different songs, or start them apart."""
    LONG_SONG = "long_song"
    FEW_SONGS = "few_songs"
    UNKNOWN_LENGTH = "unknown_length"
    """The file's length is unknown, so no song can be measured."""
    INVALID = "invalid"
    """The list is no song list a file could be split by."""


@dataclass(frozen=True)
class Doubts:
    """What looks wrong with a split: the places of songs so long they may be two, and few."""

    long: frozenset[int]
    few: bool


@dataclass(frozen=True)
class SplitOffer:
    """The songs a file may be split into, who listed them, and what makes them doubtful."""

    songs: tuple[Song, ...]
    source: OfferSource
    doubts: tuple[Doubt, ...]

    @property
    def trusted(self) -> bool:
        """Whether the file may be split by it without asking.

        Lists that agree are trusted despite a long song, as a live set's are; nothing
        is trusted that can't be saved or measured.
        """
        blocking = {Doubt.INVALID, Doubt.UNKNOWN_LENGTH, Doubt.LISTS_DIFFER}
        if self.source is OfferSource.BOTH:
            return not blocking.intersection(self.doubts)
        return not self.doubts

    @property
    def signature(self) -> str:
        """The offer as the household saw it: how many songs, and where each starts."""
        return ",".join(str(song.start_ms) for song in self.songs)


def doubts_of(starts: Sequence[int], length_ms: int | None) -> Doubts:
    """Return what looks wrong with songs starting at `starts` in a file `length_ms` long.

    A song whose end is unknown, the last of a file of unknown length, raises no doubt.
    """
    ends: list[int | None] = [*starts[1:], length_ms]
    long = frozenset(
        place
        for place, (start, end) in enumerate(zip(starts, ends, strict=True))
        if end is not None and end - start > LONG_SONG_MS
    )
    few = length_ms is not None and bool(starts) and length_ms / len(starts) > LONG_AVERAGE_MS
    return Doubts(long, few)


def lists_agree(first: Sequence[Song], second: Sequence[Song]) -> bool:
    """Return whether two lists count the same songs, each starting within `AGREE_MS`."""
    return len(first) == len(second) and all(
        abs(one.start_ms - other.start_ms) <= AGREE_MS
        for one, other in zip(first, second, strict=True)
    )


def offer_of(video: Sequence[Song], ai: Sequence[Song], length_ms: int | None) -> SplitOffer | None:
    """Return the list a file `length_ms` long may be split by, or `None` with no list."""
    if not video and not ai:
        return None
    songs = tuple(video or ai)
    both = bool(video) and bool(ai)
    source = (
        OfferSource.BOTH
        if both and lists_agree(video, ai)
        else OfferSource.VIDEO
        if video
        else OfferSource.AI
    )
    doubts: list[Doubt] = []
    if both and source is not OfferSource.BOTH:
        doubts.append(Doubt.LISTS_DIFFER)
    if length_ms is None:
        doubts.append(Doubt.UNKNOWN_LENGTH)
    if not _valid(songs, length_ms):
        doubts.append(Doubt.INVALID)
    found = doubts_of([song.start_ms for song in songs], length_ms)
    if found.long:
        doubts.append(Doubt.LONG_SONG)
    if found.few:
        doubts.append(Doubt.FEW_SONGS)
    return SplitOffer(songs, source, tuple(doubts))


def _valid(songs: Sequence[Song], length_ms: int | None) -> bool:
    """Return whether a file `length_ms` long could be split by `songs`, as a save checks."""
    try:
        check_songs(songs)
    except InvalidInputError:
        return False
    return length_ms is None or songs[-1].start_ms <= length_ms - MIN_SONG_MS
