"""The song nearest a Track among those a search found, and the song a video's title names.

A song a lyrics site has is near the Track when its title is the Track's, words in
brackets aside, and it is at most eight seconds longer or shorter. One by another artist is
near only when it is as long as the Track, within two seconds; with the Track's length
unknown, only the artist's own is. The nearest is by the Track's artist, then of its
exact title, then the closest in length:

```text
Track "Melt" by ryo, 4:20
  Melt, ryo, 4:23            near: the nearest
  Melt, ryo, 4:26            near
  Melt (Remix), ryo, 4:20    near: the same title, words in brackets aside
  Melting Point, ryo, 4:20   not near: another title
  Melt, Someone, 4:20        near: as long as the Track
  Melt, Someone, 4:23        not near: another artist, and three seconds longer
  Melt, ryo, 4:29            not near: nine seconds longer
```

A video's title often names its song among other words; the song's own title is read
out of it:

```text
【周杰伦】晴天 官方MV                 晴天
周杰伦《晴天》Official MV             晴天
米津玄師 MV「Lemon」                   Lemon
Taylor Swift - Shake It Off (Official Music Video)    Shake It Off
```
"""

import re
import unicodedata
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Final

NEAR_WITHIN: Final = 8.0
"""How many seconds longer or shorter than the Track a song of its artist may be."""
AS_LONG_WITHIN: Final = 2.0
"""How many seconds apart a song of another artist and the Track may be."""

# A song's title, held between these marks: 《晴天》, 「Lemon」, 『Lemon』.
_TITLE_MARKS: Final = re.compile(r"[《「『]([^》」』]+)[》」』]")
# What a video's title says besides its song's: a tag in brackets, or words about the video.
_TAGS: Final = re.compile(r"【[^】]*】|\[[^\]]*\]")
_ABOUT_THE_VIDEO: Final = re.compile(
    r"[(\uff08][^)\uff09]*(?:official|video|lyric|audio|mv|pv|4k|hd|高音质|高清|歌词|官方)"
    r"[^)\uff09]*[)\uff09]"
    r"|official\s+(?:music\s+)?video|official\s+mv|music\s+video|lyrics?\s+video"
    r"|官方\s*(?:版\s*)?mv|高音质|高清|歌词版|完整版|\bmv\b|\bpv\b",
    re.IGNORECASE,
)
_DASH: Final = re.compile(r"\s+[-\u2013\u2014]\s+")
_BRACKETED: Final = re.compile(r"[(\uff08\[][^)\uff09\]]*[)\uff09\]]")
_ARTISTS_APART: Final = re.compile(r"\s*(?:/|,|、|&|\bfeat\.?|\bft\.?|\u00d7)\s*", re.IGNORECASE)


@dataclass(frozen=True)
class Candidate:
    """A song a lyrics site found: its title, its artist, and how long it is, if it says."""

    title: str
    artist: str
    seconds: float | None


def song_title_of(title: str, artist: str) -> str:
    """Return the song's title in `title`, a video's or a song's own, by `artist`."""
    marked = _TITLE_MARKS.search(title)
    if marked is not None:
        return marked.group(1).strip()
    words = _ABOUT_THE_VIDEO.sub(" ", _TAGS.sub(" ", title))
    parts = [part.strip() for part in _DASH.split(words) if part.strip()]
    if len(parts) > 1:
        others = [part for part in parts if _plain(part) != _plain(artist)]
        words = (others or parts)[-1]
    return " ".join(words.split())


def nearest[C: Candidate](
    found: Iterable[C], title: str, artist: str, seconds: float | None
) -> C | None:
    """Return the song of `found` nearest the Track of `title` by `artist`, or `None`."""
    near = [
        (rank, each)
        for each in found
        if (rank := _nearness(each, title, artist, seconds)) is not None
    ]
    return min(near, key=lambda pair: pair[0])[1] if near else None


def _nearness(
    song: Candidate, title: str, artist: str, seconds: float | None
) -> tuple[bool, bool, float] | None:
    """Return how near `song` is, smaller nearer, or `None` when it isn't near."""
    theirs, ours = _plain(song.title), _plain(title)
    if not theirs or _plain(_BRACKETED.sub("", song.title)) != _plain(_BRACKETED.sub("", title)):
        return None
    by_artist = _same_artist(song.artist, artist)
    if seconds is None:
        return (False, theirs != ours, 0.0) if by_artist else None
    if song.seconds is None:
        return None
    apart = abs(song.seconds - seconds)
    if apart > NEAR_WITHIN or (not by_artist and apart > AS_LONG_WITHIN):
        return None
    return (not by_artist, theirs != ours, apart)


def _same_artist(theirs: str, ours: str) -> bool:
    """Return whether the artist a site names is one of the artists the Track names."""
    found = _plain(theirs)
    names = [_plain(name) for name in _ARTISTS_APART.split(ours)]
    return bool(found) and any(name and (name in found or found in name) for name in names)


def _plain(words: str) -> str:
    """Return `words` with case, width, spaces, and punctuation left out, to compare."""
    return "".join(ch for ch in unicodedata.normalize("NFKC", words).casefold() if ch.isalnum())
