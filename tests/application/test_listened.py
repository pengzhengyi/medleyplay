"""How long an Account listened to each play, as its page measures and sends it."""

import uuid
from datetime import timedelta

import pytest

from medleyplay.application.accounts import AccountService
from medleyplay.application.catalog import CatalogService
from medleyplay.domain.accounts import Account
from medleyplay.domain.catalog import TrackId
from medleyplay.domain.errors import InvalidInputError, NotFoundError
from medleyplay.domain.history import PlayCount
from medleyplay.domain.playback import PlayId
from tests.support.factories import NewAccountFactory, SourceKeyFactory, TrackDetailsFactory
from tests.support.fakes import FakeClock

MINUTE = 60_000
PLAY = PlayId(uuid.UUID(int=1))


def _alice(accounts: AccountService) -> Account:
    """Return Alice, the admin."""
    return accounts.create_first_admin(NewAccountFactory.admin()).account


def _three_minute_song(catalog: CatalogService) -> TrackId:
    """Add a three-minute song and return its Track."""
    return catalog.add_track(SourceKeyFactory.bilibili(), TrackDetailsFactory.song())


def test_a_play_sent_with_how_long_it_was_listened_to_keeps_that_time(
    catalog: CatalogService, accounts: AccountService, clock: FakeClock
) -> None:
    alice = _alice(accounts)
    track_id = _three_minute_song(catalog)

    catalog.record_play(alice.id, PLAY, track_id, clock.now, listened_ms=2 * MINUTE)

    counted = PlayCount(plays=1, listened_ms=2 * MINUTE, timed_plays=1)
    assert catalog.play_counts(alice.id, days=7) == {track_id: counted}
    assert catalog.play_counts(alice.id, days=None) == {track_id: counted}


def test_a_play_sent_again_with_a_longer_time_adds_only_the_increase(
    catalog: CatalogService, accounts: AccountService, clock: FakeClock
) -> None:
    alice = _alice(accounts)
    track_id = _three_minute_song(catalog)
    catalog.record_play(alice.id, PLAY, track_id, clock.now, listened_ms=2 * MINUTE)

    again = catalog.record_play(alice.id, PLAY, track_id, clock.now, listened_ms=3 * MINUTE)

    assert again.play_count == 1
    counted = PlayCount(plays=1, listened_ms=3 * MINUTE, timed_plays=1)
    assert catalog.play_counts(alice.id, days=7) == {track_id: counted}
    assert catalog.play_counts(alice.id, days=None) == {track_id: counted}


def test_a_shorter_time_sent_late_such_as_a_retry_changes_nothing(
    catalog: CatalogService, accounts: AccountService, clock: FakeClock
) -> None:
    alice = _alice(accounts)
    track_id = _three_minute_song(catalog)
    catalog.record_play(alice.id, PLAY, track_id, clock.now, listened_ms=3 * MINUTE)

    catalog.record_play(alice.id, PLAY, track_id, clock.now, listened_ms=2 * MINUTE)

    counted = PlayCount(plays=1, listened_ms=3 * MINUTE, timed_plays=1)
    assert catalog.play_counts(alice.id, days=None) == {track_id: counted}


def test_a_play_first_sent_without_a_time_is_timed_once_a_time_comes(
    catalog: CatalogService, accounts: AccountService, clock: FakeClock
) -> None:
    alice = _alice(accounts)
    track_id = _three_minute_song(catalog)
    catalog.record_play(alice.id, PLAY, track_id, clock.now)

    catalog.record_play(alice.id, PLAY, track_id, clock.now, listened_ms=2 * MINUTE)

    counted = PlayCount(plays=1, listened_ms=2 * MINUTE, timed_plays=1)
    assert catalog.play_counts(alice.id, days=None) == {track_id: counted}


def test_a_time_past_the_tracks_length_counts_as_its_length(
    catalog: CatalogService, accounts: AccountService, clock: FakeClock
) -> None:
    alice = _alice(accounts)
    track_id = _three_minute_song(catalog)

    catalog.record_play(alice.id, PLAY, track_id, clock.now, listened_ms=10 * MINUTE)

    counted = PlayCount(plays=1, listened_ms=3 * MINUTE, timed_plays=1)
    assert catalog.play_counts(alice.id, days=None) == {track_id: counted}


def test_an_album_file_keeps_the_whole_time_it_was_listened_to(
    catalog: CatalogService, accounts: AccountService, clock: FakeClock
) -> None:
    alice = _alice(accounts)
    album = catalog.add_track(SourceKeyFactory.bilibili(), TrackDetailsFactory.album_file())

    catalog.record_play(alice.id, PLAY, album, clock.now, listened_ms=52 * MINUTE)

    counted = PlayCount(plays=1, listened_ms=52 * MINUTE, timed_plays=1)
    assert catalog.play_counts(alice.id, days=30) == {album: counted}


@pytest.mark.parametrize("listened_ms", [-1, 24 * 60 * MINUTE + 1])
def test_a_time_below_zero_or_over_a_day_is_refused(
    catalog: CatalogService, accounts: AccountService, clock: FakeClock, listened_ms: int
) -> None:
    alice = _alice(accounts)
    track_id = _three_minute_song(catalog)

    with pytest.raises(InvalidInputError, match="0 to 24 hours"):
        catalog.record_play(alice.id, PLAY, track_id, clock.now, listened_ms=listened_ms)


def test_a_time_noted_for_a_play_the_server_does_not_have_counts_no_play(
    catalog: CatalogService, accounts: AccountService
) -> None:
    alice = _alice(accounts)
    track_id = _three_minute_song(catalog)

    with pytest.raises(NotFoundError, match="No play"):
        catalog.note_listened(alice.id, PLAY, 2 * MINUTE)

    assert catalog.get_track(alice.id, track_id).play_count == 0


def test_a_time_noted_for_a_play_adds_to_the_time_it_was_sent_with(
    catalog: CatalogService, accounts: AccountService, clock: FakeClock
) -> None:
    alice = _alice(accounts)
    track_id = _three_minute_song(catalog)
    catalog.record_play(alice.id, PLAY, track_id, clock.now, listened_ms=2 * MINUTE)

    catalog.note_listened(alice.id, PLAY, 3 * MINUTE)

    counted = PlayCount(plays=1, listened_ms=3 * MINUTE, timed_plays=1)
    assert catalog.play_counts(alice.id, days=None) == {track_id: counted}


def test_listening_time_stays_in_all_time_counts_once_its_play_is_past_the_period(
    catalog: CatalogService, accounts: AccountService, clock: FakeClock
) -> None:
    alice = _alice(accounts)
    track_id = _three_minute_song(catalog)
    catalog.record_play(alice.id, PLAY, track_id, clock.now, listened_ms=2 * MINUTE)
    clock.advance(timedelta(days=40))

    counts = catalog.play_counts(alice.id, days=30), catalog.play_counts(alice.id, days=None)

    assert counts == ({}, {track_id: PlayCount(plays=1, listened_ms=2 * MINUTE, timed_plays=1)})
