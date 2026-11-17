"""Lyrics of a song: timed lines read from LRC, or plain text.

LRC times each line, and may time each word, as Enhanced LRC does:

```text
[ti:Melt]                         a tag about the song, not a line
[offset:+500]                     every line half a second earlier
[00:12.34]朝目が覚めて               a line, and the time it is sung
[00:12.34]Waking up               the same time again: its translation
[00:30.00][01:30.00]Chorus        a line sung at each time
[01:00.00]<01:00.00>Hello <01:00.50>world   each word at its own time
```

Text with no times is plain lyrics, read as written.
"""

import re
from dataclasses import dataclass
from enum import StrEnum
from typing import Final

from medleyplay.domain.errors import InvalidInputError

MAX_LYRICS: Final = 64 * 1024
"""The most characters lyrics may hold."""
MAX_LINES: Final = 2_000
"""The most timed lines lyrics may hold."""

_TIME: Final = re.compile(r"\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]")
_TAG: Final = re.compile(r"^\[([a-z]+):(.*)\]$", re.IGNORECASE)
_WORD: Final = re.compile(r"<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>")


class LyricsOrigin(StrEnum):
    """Where a song's lyrics came from, first first: the one shown is the first held."""

    HOUSEHOLD = "household"
    SIDECAR = "sidecar"
    """A `.lrc` file beside the audio, named as it is."""
    TAG = "tag"
    """The audio file's own tags."""
    LRCLIB = "lrclib"
    """LRCLIB, the open lyrics database at lrclib.net."""
    NETEASE = "netease"
    """NetEase Cloud Music, asked when LRCLIB has none and the household turned it on."""

    @property
    def local(self) -> bool:
        """Whether the household or its files gave them, so no site's replace them."""
        return self in {LyricsOrigin.HOUSEHOLD, LyricsOrigin.SIDECAR, LyricsOrigin.TAG}


class LyricsSite(StrEnum):
    """A site the household may turn on to be asked for lyrics LRCLIB doesn't have."""

    NETEASE = "netease"


@dataclass(frozen=True)
class Word:
    """One word of a line, and the time it is sung, in milliseconds."""

    at_ms: int
    text: str


@dataclass(frozen=True)
class Line:
    """One line of lyrics, the time it is sung, its translation, and its words when timed."""

    at_ms: int
    text: str
    translation: str = ""
    words: tuple[Word, ...] = ()


@dataclass(frozen=True)
class Lyrics:
    """Lyrics as timed lines, or as plain text when nothing times them."""

    synced: bool
    lines: tuple[Line, ...] = ()
    plain: str = ""


def parse_lyrics(text: str) -> Lyrics:
    """Read `text` as LRC when a line of it is timed, else as plain lyrics.

    Refused when longer than `MAX_LYRICS` characters or `MAX_LINES` timed lines.
    """
    if len(text) > MAX_LYRICS:
        message = f"Lyrics are at most {MAX_LYRICS:,} characters."
        raise InvalidInputError(message)
    rows = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    if not any(_TIME.match(row.strip()) for row in rows):
        return Lyrics(synced=False, plain=text.strip())
    offset = 0
    timed: list[tuple[int, str]] = []
    for row in rows:
        stripped = row.strip()
        tag = _TAG.match(stripped)
        if tag is not None and not _TIME.match(stripped):
            if tag.group(1).lower() == "offset":
                offset = _offset_of(tag.group(2))
            continue
        times = []
        rest = stripped
        while (found := _TIME.match(rest)) is not None:
            times.append(_ms(found))
            rest = rest[found.end() :]
        timed.extend((at, rest.strip()) for at in times)
    if len(timed) > MAX_LINES:
        message = f"Lyrics have at most {MAX_LINES:,} timed lines."
        raise InvalidInputError(message)
    return Lyrics(synced=True, lines=_lines(sorted(timed, key=lambda each: each[0]), offset))


def _lines(timed: list[tuple[int, str]], offset: int) -> tuple[Line, ...]:
    """Return the lines sung at each time, a second line at one time its translation."""
    lines: list[Line] = []
    for at, written in timed:
        shifted = max(at - offset, 0)
        if lines and lines[-1].at_ms == shifted and not lines[-1].translation and written:
            lines[-1] = Line(shifted, lines[-1].text, written, lines[-1].words)
            continue
        words = _words(written, offset)
        lines.append(
            Line(shifted, "".join(word.text for word in words) if words else written, "", words)
        )
    return tuple(lines)


def _words(written: str, offset: int) -> tuple[Word, ...]:
    """Return the words of a line timed word by word, or none for a line timed as a whole."""
    marks = list(_WORD.finditer(written))
    if not marks:
        return ()
    words = []
    for index, mark in enumerate(marks):
        end = marks[index + 1].start() if index + 1 < len(marks) else len(written)
        word = written[mark.end() : end]
        if word:
            words.append(Word(max(_ms(mark) - offset, 0), word))
    return tuple(words)


def _ms(found: re.Match[str]) -> int:
    """Return the milliseconds a `[mm:ss.xx]` or `<mm:ss.xx>` time stands for."""
    minutes, seconds, fraction = found.group(1), found.group(2), found.group(3) or "0"
    return (int(minutes) * 60 + int(seconds)) * 1000 + int(fraction.ljust(3, "0")[:3])


def _offset_of(value: str) -> int:
    """Return an `[offset:]` tag's milliseconds; a positive one makes every line earlier."""
    try:
        return int(value.strip())
    except ValueError:
        return 0
