"""An Account's History: the plays it made, newest first, until it clears them."""

import uuid
from datetime import datetime, timedelta

import pytest

from medleyplay.application.accounts import AccountService
from medleyplay.application.catalog import CatalogService
from medleyplay.domain.accounts import Account
from medleyplay.domain.catalog import TrackId
from medleyplay.domain.errors import InvalidInputError
from medleyplay.domain.history import KEPT_PLAYS, Played
from medleyplay.domain.playback import PlayId
from tests.support.factories import NewAccountFactory, SourceKeyFactory, TrackDetailsFactory
from tests.support.fakes import FakeClock


def _alice_and_bob(accounts: AccountService) -> tuple[Account, Account]:
    """Return Alice, the admin, and Bob, a member."""
    alice = accounts.create_first_admin(NewAccountFactory.admin()).account
    return alice, accounts.create_account(alice, NewAccountFactory.member())


def _two_tracks(catalog: CatalogService) -> list[TrackId]:
    """Add two parts of one Bilibili video and return their Tracks."""
    return [
        catalog.add_track(
            SourceKeyFactory.bilibili(part=part), TrackDetailsFactory.song(f"P{part}")
        )
        for part in (1, 2)
    ]


def _play(number: int) -> PlayId:
    """Return the play id the page would choose for its `number`th play."""
    return PlayId(uuid.UUID(int=number))


def _play_minutes_apart(
    catalog: CatalogService, account: Account, track_id: TrackId, count: int, first: datetime
) -> None:
    """Record `count` plays of `track_id`, a minute apart from `first`, numbered from 1."""
    for number in range(1, count + 1):
        catalog.record_play(
            account.id, _play(number), track_id, first + timedelta(minutes=number - 1)
        )


def test_history_lists_an_accounts_plays_newest_first_a_song_played_twice_twice(
    catalog: CatalogService, accounts: AccountService, clock: FakeClock
) -> None:
    alice, _ = _alice_and_bob(accounts)
    first, second = _two_tracks(catalog)
    an_hour_ago = clock.now - timedelta(hours=1)
    catalog.record_play(alice.id, _play(1), first, an_hour_ago)
    catalog.record_play(alice.id, _play(2), second, an_hour_ago + timedelta(minutes=4))
    catalog.record_play(alice.id, _play(3), first, an_hour_ago + timedelta(minutes=8))

    history = catalog.history(alice.id, limit=50)

    assert history == (
        Played(_play(3), first, an_hour_ago + timedelta(minutes=8)),
        Played(_play(2), second, an_hour_ago + timedelta(minutes=4)),
        Played(_play(1), first, an_hour_ago),
    )


def test_a_play_sent_late_sorts_by_when_it_was_played(
    catalog: CatalogService, accounts: AccountService, clock: FakeClock
) -> None:
    alice, _ = _alice_and_bob(accounts)
    first, second = _two_tracks(catalog)
    catalog.record_play(alice.id, _play(1), first, clock.now)

    catalog.record_play(alice.id, _play(2), second, clock.now - timedelta(days=3))

    assert [played.play_id for played in catalog.history(alice.id, limit=50)] == [
        _play(1),
        _play(2),
    ]


def test_each_account_has_its_own_history(
    catalog: CatalogService, accounts: AccountService, clock: FakeClock
) -> None:
    alice, bob = _alice_and_bob(accounts)
    [track_id, _] = _two_tracks(catalog)
    catalog.record_play(alice.id, _play(1), track_id, clock.now)

    assert catalog.history(bob.id, limit=50) == ()


def test_history_shows_the_newest_plays_up_to_the_limit(
    catalog: CatalogService, accounts: AccountService, clock: FakeClock
) -> None:
    alice, _ = _alice_and_bob(accounts)
    [track_id, _] = _two_tracks(catalog)
    _play_minutes_apart(catalog, alice, track_id, 30, clock.now - timedelta(hours=2))

    history = catalog.history(alice.id, limit=25)

    assert [played.play_id for played in history] == [_play(n) for n in range(30, 5, -1)]


@pytest.mark.parametrize("limit", [0, KEPT_PLAYS + 1])
def test_a_history_limit_outside_1_to_500_is_refused(
    catalog: CatalogService, accounts: AccountService, limit: int
) -> None:
    alice, _ = _alice_and_bob(accounts)

    with pytest.raises(InvalidInputError, match="1 to 500"):
        catalog.history(alice.id, limit=limit)


def test_clearing_history_empties_it_and_keeps_play_counts(
    catalog: CatalogService, accounts: AccountService, clock: FakeClock
) -> None:
    alice, bob = _alice_and_bob(accounts)
    [track_id, _] = _two_tracks(catalog)
    catalog.record_play(alice.id, _play(1), track_id, clock.now)
    catalog.record_play(bob.id, _play(1), track_id, clock.now)

    catalog.clear_history(alice.id)

    assert catalog.history(alice.id, limit=50) == ()
    assert catalog.get_track(alice.id, track_id).play_count == 1
    assert catalog.history(bob.id, limit=50) == (Played(_play(1), track_id, clock.now),)


def test_a_cleared_play_sent_again_counts_once_and_stays_cleared(
    catalog: CatalogService, accounts: AccountService, clock: FakeClock
) -> None:
    alice, _ = _alice_and_bob(accounts)
    [track_id, _] = _two_tracks(catalog)
    catalog.record_play(alice.id, _play(1), track_id, clock.now)
    catalog.clear_history(alice.id)

    again = catalog.record_play(alice.id, _play(1), track_id, clock.now)

    assert again.play_count == 1
    assert catalog.history(alice.id, limit=50) == ()


def test_a_play_recorded_after_clearing_shows_though_it_was_played_before(
    catalog: CatalogService, accounts: AccountService, clock: FakeClock
) -> None:
    alice, _ = _alice_and_bob(accounts)
    first, second = _two_tracks(catalog)
    catalog.record_play(alice.id, _play(1), first, clock.now)
    catalog.clear_history(alice.id)

    catalog.record_play(alice.id, _play(2), second, clock.now - timedelta(hours=1))

    assert catalog.history(alice.id, limit=50) == (
        Played(_play(2), second, clock.now - timedelta(hours=1)),
    )


def test_a_play_recorded_over_30_days_ago_past_the_newest_500_is_forgotten(
    catalog: CatalogService, accounts: AccountService, clock: FakeClock
) -> None:
    alice, _ = _alice_and_bob(accounts)
    first, second = _two_tracks(catalog)
    _play_minutes_apart(catalog, alice, first, KEPT_PLAYS + 2, clock.now - timedelta(days=1))
    clock.advance(timedelta(days=31))
    catalog.record_play(alice.id, _play(KEPT_PLAYS + 3), second, clock.now)

    # Plays 1 to 3 are past the newest 500, so play 1 sent again counts again.
    again = catalog.record_play(alice.id, _play(1), first, clock.now - timedelta(days=32))

    assert again.play_count == KEPT_PLAYS + 3


def test_a_play_recorded_within_30_days_is_kept_past_the_newest_500(
    catalog: CatalogService, accounts: AccountService, clock: FakeClock
) -> None:
    alice, _ = _alice_and_bob(accounts)
    first, second = _two_tracks(catalog)
    _play_minutes_apart(catalog, alice, first, KEPT_PLAYS + 2, clock.now - timedelta(days=1))
    clock.advance(timedelta(days=29))
    catalog.record_play(alice.id, _play(KEPT_PLAYS + 3), second, clock.now)

    again = catalog.record_play(alice.id, _play(1), first, clock.now - timedelta(days=30))

    assert again.play_count == KEPT_PLAYS + 2
