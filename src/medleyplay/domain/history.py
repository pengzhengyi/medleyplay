"""History: the songs an Account played, newest first, until it clears them."""

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Final, Literal, get_args

from medleyplay.domain.catalog import TrackId
from medleyplay.domain.playback import PlayId

type HistoryLength = Literal[25, 50, 100, 250, 500]
"""How many songs History can show, as the page offers them."""
HISTORY_LENGTHS: Final[tuple[int, ...]] = get_args(HistoryLength.__value__)
DEFAULT_HISTORY_LENGTH: Final = 50

KEPT_PLAYS: Final = 500
"""How many of an Account's newest plays are always kept, the most History shows."""
KEPT_FOR: Final = timedelta(days=30)
"""How long a play is kept once recorded.

A play sent again is then known and counted once, and Insights can count the
plays of its longest period, which this must cover.
"""

type PlayCountPeriod = Literal[7, 30]
"""How many days back Insights can count an Account's plays."""
PLAY_COUNT_PERIODS: Final[tuple[int, ...]] = get_args(PlayCountPeriod.__value__)


@dataclass(frozen=True)
class Played:
    """One play in an Account's History: its id, its Track, and when it was played."""

    play_id: PlayId
    track_id: TrackId
    played_at: datetime
