"""Where a Track's audio falls quiet, and whether that is known yet.

The gaps between an album's songs are silences a second or more long, so song
starts guessed from a video's text or an AI model can be moved onto them.
"""

from dataclasses import dataclass
from enum import StrEnum


@dataclass(frozen=True)
class Silence:
    """A quiet stretch of the audio, from `start_ms` to `end_ms`."""

    start_ms: int
    end_ms: int


class SilenceState(StrEnum):
    """What is known of a Track's silences."""

    FOUND = "found"
    FINDING = "finding"
    """They are being found now."""
    PREPARING = "preparing"
    """The file must be copied or downloaded before it can be read."""
    NOT_FOUND = "not_found"
    """They haven't been looked for, or the file changed since they were."""
    NO_TOOL = "no_tool"
    """The program that finds them isn't installed on the server."""
    UNREADABLE = "unreadable"
    """The program couldn't read the file as audio."""


@dataclass(frozen=True)
class Silences:
    """What is known of a Track's silences, and the silences, in order, once found."""

    state: SilenceState
    silences: tuple[Silence, ...] = ()
