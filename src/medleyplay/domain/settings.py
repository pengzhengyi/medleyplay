"""The household's settings, shared by every Account and changed by an admin."""

from dataclasses import dataclass
from enum import StrEnum
from typing import Final

ALBUM_MINUTES: Final = 20
"""How long a file must be, by default, to be guessed an album."""


class RemovalOrder(StrEnum):
    """Which Download the policy removes first when it must make room."""

    LEAST_FAVORITE = "least_favorite"


@dataclass(frozen=True)
class Settings:
    """The settings, and the revision they were read at; revision 0 was never saved.

    `storage_limit` is the most bytes Downloads and cache copies may use, or
    `None` for no limit, so nothing is removed. A file no origin names the kind
    of is guessed an album when it is `album_minutes` long or longer; `None`
    guesses none, so it is a song.
    """

    storage_limit: int | None = None
    removal_order: RemovalOrder = RemovalOrder.LEAST_FAVORITE
    album_minutes: int | None = ALBUM_MINUTES
    revision: int = 0

    @property
    def album_from_ms(self) -> int | None:
        """Return how long a file must be to be guessed an album, in milliseconds."""
        return None if self.album_minutes is None else self.album_minutes * 60_000
