"""Each Track's artists by id: every name it shows bound to one of the Library's artists."""

from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.accounts import AccountService
from medleyplay.application.track_artists import BoundArtist, TrackArtists, artists_of
from medleyplay.domain.accounts import Account
from medleyplay.domain.catalog import TrackId
from tests.support.enrichment import Enriching, running_enrichment
from tests.support.factories import NewAccountFactory
from tests.support.fakes import FakeClock

BEATLES = "b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d"
TRIBUTE = "6a3b5c1e-0000-4000-8000-0000000b0a1d"
"""Another artist MusicBrainz names for *披头士* and *甲壳虫*: a tribute band."""


@pytest.fixture
def alice(accounts: AccountService) -> Account:
    return accounts.create_first_admin(NewAccountFactory.admin()).account


@pytest.fixture
def enriching(
    units: sessionmaker[Session], clock: FakeClock, tmp_path: Path
) -> Iterator[Enriching]:
    with running_enrichment(units, clock, tmp_path / "data") as running:
        yield running


def _artists(units: sessionmaker[Session], track_id: TrackId) -> TrackArtists:
    with units() as db:
        return artists_of(db, track_id)


def _artist_id(units: sessionmaker[Session], track_id: TrackId) -> str:
    """The id of the one artist the Track shows as its artist."""
    [artist] = _artists(units, track_id).artists
    return artist.artist_id


def _looked_up(enriching: Enriching, alice: Account, *names: str) -> None:
    """Look `names` up, and wait until MusicBrainz has answered each."""
    enriching.artists.look_up(alice, names)
    enriching.finish_every_job()


def test_a_songs_artist_and_album_artist_are_each_bound_to_an_artist_as_written(
    enriching: Enriching, units: sessionmaker[Session]
) -> None:
    song = enriching.add_song("Yesterday", artist="Paul McCartney", album_artist="The Beatles")

    artists = _artists(units, song)

    assert [each.written for each in artists.artists] == ["Paul McCartney"]
    assert [each.written for each in artists.album_artists] == ["The Beatles"]
    assert artists.artists[0].artist_id != artists.album_artists[0].artist_id


def test_songs_writing_one_name_differently_name_one_artist(
    enriching: Enriching, units: sessionmaker[Session]
) -> None:
    first = enriching.add_song("Help!", artist="Beatles")
    second = enriching.add_song("Yesterday", artist=" BEATLES")
    album = enriching.add_song("Abbey Road", artist="", album_artist="beatles")

    ids = {
        _artist_id(units, first),
        _artist_id(units, second),
        _artists(units, album).album_artists[0].artist_id,
    }

    assert len(ids) == 1


def test_a_song_naming_no_artist_is_bound_to_none(
    enriching: Enriching, units: sessionmaker[Session]
) -> None:
    song = enriching.add_song("Untitled", artist="")

    assert _artists(units, song) == TrackArtists(artists=(), album_artists=())


def test_a_song_whose_artist_is_corrected_is_bound_to_the_corrected_names_artist(
    enriching: Enriching, units: sessionmaker[Session]
) -> None:
    wrong = enriching.add_song("Creep", artist="Radio Head")
    right = enriching.add_song("Karma Police", artist="Radiohead")
    misspelled = _artist_id(units, wrong)

    enriching.details.put_household(wrong, {"artist": "Radiohead"})

    assert _artist_id(units, wrong) == _artist_id(units, right)
    assert _artist_id(units, wrong) != misspelled


def test_names_linked_to_one_musicbrainz_artist_name_one_artist(
    enriching: Enriching, units: sessionmaker[Session], alice: Account
) -> None:
    chinese = enriching.add_song("Yesterday", artist="披头士")
    other = enriching.add_song("Help!", artist="甲壳虫")
    _looked_up(enriching, alice, "披头士", "甲壳虫")

    enriching.artists.link(alice, "披头士", BEATLES)
    enriching.artists.link(alice, "甲壳虫", BEATLES)

    assert _artist_id(units, chinese) == _artist_id(units, other)


def test_an_artist_keeps_its_id_when_its_name_is_linked(
    enriching: Enriching, units: sessionmaker[Session], alice: Account
) -> None:
    song = enriching.add_song("Yesterday", artist="披头士")
    _looked_up(enriching, alice, "披头士")
    before = _artist_id(units, song)

    enriching.artists.link(alice, "披头士", BEATLES)

    assert _artist_id(units, song) == before


def test_a_song_added_under_a_name_linked_before_joins_the_linked_artist(
    enriching: Enriching, units: sessionmaker[Session], alice: Account
) -> None:
    linked = enriching.add_song("Yesterday", artist="披头士")
    _looked_up(enriching, alice, "披头士", "甲壳虫")
    enriching.artists.link(alice, "披头士", BEATLES)
    enriching.artists.link(alice, "甲壳虫", BEATLES)

    added = enriching.add_song("Help!", artist="甲壳虫")

    assert _artist_id(units, added) == _artist_id(units, linked)


def test_relinking_one_of_an_artists_names_moves_only_that_names_songs(
    enriching: Enriching, units: sessionmaker[Session], alice: Account
) -> None:
    kept = enriching.add_song("Yesterday", artist="披头士")
    moved = enriching.add_song("Help!", artist="甲壳虫")
    _looked_up(enriching, alice, "披头士", "甲壳虫")
    enriching.artists.link(alice, "披头士", BEATLES)
    enriching.artists.link(alice, "甲壳虫", BEATLES)
    beatles = _artist_id(units, kept)

    enriching.artists.link(alice, "甲壳虫", TRIBUTE)

    assert _artist_id(units, kept) == beatles
    assert _artist_id(units, moved) != beatles


def test_unlinking_one_of_an_artists_names_parts_it_from_the_artist(
    enriching: Enriching, units: sessionmaker[Session], alice: Account
) -> None:
    kept = enriching.add_song("Yesterday", artist="披头士")
    parted = enriching.add_song("Help!", artist="甲壳虫")
    _looked_up(enriching, alice, "披头士", "甲壳虫")
    enriching.artists.link(alice, "披头士", BEATLES)
    enriching.artists.link(alice, "甲壳虫", BEATLES)

    enriching.artists.unlink("甲壳虫")

    assert _artist_id(units, parted) != _artist_id(units, kept)


def test_linking_the_last_name_of_an_artist_to_another_keeps_it_as_one_artist(
    enriching: Enriching, units: sessionmaker[Session], alice: Account
) -> None:
    song = enriching.add_song("Yesterday", artist="披头士")
    _looked_up(enriching, alice, "披头士")
    enriching.artists.link(alice, "披头士", BEATLES)
    before = _artist_id(units, song)

    enriching.artists.link(alice, "披头士", TRIBUTE)

    assert _artists(units, song).artists == (BoundArtist(artist_id=before, written="披头士"),)
