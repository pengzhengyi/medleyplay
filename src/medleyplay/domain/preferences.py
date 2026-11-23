"""An Account's preferences: its own choices for its pages, kept wherever it signs in."""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal

type LyricsMatchConfirmation = Literal["ask", "direct"]


@dataclass(frozen=True)
class Preferences:
    """An Account's preferences, and the revision they were read at; revision 0 was never saved.

    `shortcuts` gives each command the web client names its keys, written as the
    page writes them, such as `shift+right`; `None` leaves every command on the
    page's defaults. The server keeps them without knowing the commands, so a
    page with a new command needs no change here. `history_length` is how many
    songs History shows. `lyrics_match_confirmation` is whether Auto-Match lyrics
    asks before searching; `None` leaves either preference at its default.
    """

    shortcuts: Mapping[str, tuple[str, ...]] | None = None
    history_length: int | None = None
    lyrics_match_confirmation: LyricsMatchConfirmation | None = None
    revision: int = 0
