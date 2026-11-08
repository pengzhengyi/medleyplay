"""How long plays are kept, and the periods Insights counts them over."""

from datetime import timedelta

from medleyplay.domain.history import KEPT_FOR, PLAY_COUNT_PERIODS


def test_every_period_plays_are_counted_over_fits_in_how_long_plays_are_kept() -> None:
    longest = timedelta(days=max(PLAY_COUNT_PERIODS))

    assert longest <= KEPT_FOR
