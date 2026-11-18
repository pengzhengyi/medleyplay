"""Artists sharing a name: telling a name's songs apart album by album, or keeping it as one."""

from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.accounts import AccountService
from medleyplay.application.shared_names import AlbumSongs, SharedName, SharedNameService
from medleyplay.application.track_artists import SongsBy, artists_of
from medleyplay.domain.accounts import Account
from medleyplay.domain.catalog import TrackId
from medleyplay.domain.errors import InvalidInputError, NotFoundError
from medleyplay.persistence.schema import LibraryArtistRow
from tests.support.enrichment import Enriching, running_enrichment
from tests.support.factories import NewAccountFactory
from tests.support.fakes import FakeClock
from tests.support.plugins.reader import BEATLES, JAY_CHOU, JAY_RAPPER


@pytest.fixture
def alice(accounts: AccountService) -> Account:
    return accounts.create_first_admin(NewAccountFactory.admin()).account


@pytest.fixture
def enriching(
    units: sessionmaker[Session], clock: FakeClock, tmp_path: Path
) -> Iterator[Enriching]:
    with running_enrichment(units, clock, tmp_path / "data") as running:
        yield running


@pytest.fixture
def shared(units: sessionmaker[Session], clock: FakeClock) -> SharedNameService:
    return SharedNameService(units, clock)


def _two_jays(enriching: Enriching) -> tuple[TrackId, TrackId, TrackId]:
    """Two songs of *范特西* and one of *Rap Tape*, each by *Jay*."""
    return (
        enriching.add_song("双截棍", artist="Jay", album="范特西"),
        enriching.add_song("爱在西元前", artist="Jay", album="范特西"),
        enriching.add_song("Grime Time", artist="Jay", album="Rap Tape"),
    )


def _looked_up(enriching: Enriching, alice: Account, *names: str) -> None:
    """Look `names` up, and wait until MusicBrainz has answered each."""
    enriching.artists.look_up(alice, names)
    enriching.finish_every_job()


def _shared(service: SharedNameService, name: str) -> SharedName:
    """The name `name`, as the names shared by artists list it."""
    return next(each for each in service.names() if each.name == name)


def _album(named: SharedName, album: str) -> AlbumSongs:
    """The songs of `album` the name lists, by one artist."""
    return next(each for each in named.albums if each.album == album)


def _artist_id(units: sessionmaker[Session], track_id: TrackId) -> str:
    """The id of the one artist the Track shows as its artist."""
    with units() as db:
        [artist] = artists_of(db, track_id).artists
    return artist.artist_id


def _musicbrainz_id(units: sessionmaker[Session], artist_id: str) -> str | None:
    """The MusicBrainz artist the Library's artist `artist_id` is linked to."""
    with units() as db:
        return db.get_one(LibraryArtistRow, artist_id).musicbrainz_id


def _told_apart(
    shared: SharedNameService, songs: tuple[TrackId, TrackId, TrackId]
) -> tuple[str, str]:
    """Tell *Jay* apart: *范特西* by Jay Chou, *Rap Tape* by the rapper."""
    fantasy_one, fantasy_two, rap = songs
    shared.assign(
        "Jay",
        [
            SongsBy((fantasy_one, fantasy_two), musicbrainz_id=JAY_CHOU.id),
            SongsBy((rap,), musicbrainz_id=JAY_RAPPER.id),
        ],
    )
    return JAY_CHOU.id, JAY_RAPPER.id


def test_a_name_musicbrainz_knows_two_artists_by_exactly_waits_to_be_told_apart(
    enriching: Enriching, alice: Account, shared: SharedNameService
) -> None:
    _two_jays(enriching)

    _looked_up(enriching, alice, "Jay")

    named = _shared(shared, "Jay")
    assert named.known == (JAY_CHOU.id, JAY_RAPPER.id)
    assert (len(named.artists), named.kept, named.waiting) == (1, False, True)
    assert [(each.album, len(each.track_ids), each.confirmed) for each in named.albums] == [
        ("范特西", 2, False),
        ("Rap Tape", 1, False),
    ]


def test_a_name_musicbrainz_knows_one_artist_by_is_not_listed(
    enriching: Enriching, alice: Account, shared: SharedNameService
) -> None:
    enriching.add_song("Yesterday", artist="披头士")

    _looked_up(enriching, alice, "披头士")

    assert shared.names() == ()


def test_songs_told_apart_by_album_are_each_bound_to_the_artist_chosen_for_their_album(
    enriching: Enriching, alice: Account, units: sessionmaker[Session], shared: SharedNameService
) -> None:
    songs = _two_jays(enriching)
    fantasy_one, fantasy_two, rap = songs
    _looked_up(enriching, alice, "Jay")

    _told_apart(shared, songs)

    assert _artist_id(units, fantasy_one) == _artist_id(units, fantasy_two)
    assert _musicbrainz_id(units, _artist_id(units, fantasy_one)) == JAY_CHOU.id
    assert _musicbrainz_id(units, _artist_id(units, rap)) == JAY_RAPPER.id
    named = _shared(shared, "Jay")
    assert [each.musicbrainz_id for each in named.artists] == [JAY_CHOU.id, JAY_RAPPER.id]
    assert all(each.confirmed for each in named.albums)
    assert not named.waiting


def test_the_album_of_most_songs_keeps_the_artist_the_name_named(
    enriching: Enriching, alice: Account, units: sessionmaker[Session], shared: SharedNameService
) -> None:
    songs = _two_jays(enriching)
    before = _artist_id(units, songs[0])
    _looked_up(enriching, alice, "Jay")

    _told_apart(shared, songs)

    assert _artist_id(units, songs[0]) == before
    assert _artist_id(units, songs[2]) != before


def test_the_name_is_linked_to_its_first_artist_once_told_apart(
    enriching: Enriching, alice: Account, shared: SharedNameService
) -> None:
    songs = _two_jays(enriching)
    _looked_up(enriching, alice, "Jay")

    _told_apart(shared, songs)

    [named] = [each for each in enriching.artists.names().names if each.name == "Jay"]
    assert (named.linked, named.artist_id) == (True, JAY_CHOU.id)


def test_an_album_told_apart_as_an_artist_another_name_is_linked_to_joins_that_artist(
    enriching: Enriching, alice: Account, units: sessionmaker[Session], shared: SharedNameService
) -> None:
    songs = _two_jays(enriching)
    chou = enriching.add_song("晴天", artist="周杰伦", album="叶惠美")
    _looked_up(enriching, alice, "Jay")
    enriching.artists.link(alice, "周杰伦", JAY_CHOU.id)
    enriching.finish_every_job()

    _told_apart(shared, songs)

    assert _artist_id(units, songs[0]) == _artist_id(units, chou)


def test_a_song_added_to_an_album_told_apart_waits_to_be_confirmed(
    enriching: Enriching, alice: Account, units: sessionmaker[Session], shared: SharedNameService
) -> None:
    songs = _two_jays(enriching)
    _looked_up(enriching, alice, "Jay")
    _told_apart(shared, songs)

    added = enriching.add_song("Bars", artist="Jay", album="Rap Tape")

    assert _artist_id(units, added) == _artist_id(units, songs[2])
    named = _shared(shared, "Jay")
    assert named.waiting
    assert [(each.album, each.track_ids) for each in named.albums if not each.confirmed] == [
        ("Rap Tape", (songs[2], added))
    ]


def test_albums_may_trade_artists_at_once(
    enriching: Enriching, alice: Account, units: sessionmaker[Session], shared: SharedNameService
) -> None:
    rap = enriching.add_song("Grime Time", artist="Jay", album="Rap Tape")
    fantasy_one = enriching.add_song("双截棍", artist="Jay", album="范特西")
    fantasy_two = enriching.add_song("爱在西元前", artist="Jay", album="范特西")
    _looked_up(enriching, alice, "Jay")
    _told_apart(shared, (fantasy_one, fantasy_two, rap))
    chou, rapper = _artist_id(units, fantasy_one), _artist_id(units, rap)

    shared.assign(
        "Jay",
        [SongsBy((fantasy_one, fantasy_two), artist_id=rapper), SongsBy((rap,), artist_id=chou)],
    )

    assert (_artist_id(units, fantasy_one), _artist_id(units, rap)) == (rapper, chou)


def test_every_album_told_apart_as_one_artist_keeps_the_name_as_one(
    enriching: Enriching, alice: Account, units: sessionmaker[Session], shared: SharedNameService
) -> None:
    fantasy_one, fantasy_two, rap = _two_jays(enriching)
    _looked_up(enriching, alice, "Jay")

    shared.assign("Jay", [SongsBy((fantasy_one, fantasy_two, rap), musicbrainz_id=JAY_CHOU.id)])

    named = _shared(shared, "Jay")
    assert (len(named.artists), named.kept, named.waiting) == (1, True, False)
    assert _musicbrainz_id(units, _artist_id(units, rap)) == JAY_CHOU.id


def test_a_first_artist_left_with_no_song_of_the_name_gives_it_up(
    enriching: Enriching, alice: Account, units: sessionmaker[Session], shared: SharedNameService
) -> None:
    fantasy_one, fantasy_two, rap = _two_jays(enriching)
    _looked_up(enriching, alice, "Jay")
    enriching.artists.link(alice, "Jay", JAY_CHOU.id)

    shared.assign("Jay", [SongsBy((fantasy_one, fantasy_two, rap), musicbrainz_id=JAY_RAPPER.id)])

    [named] = [each for each in enriching.artists.names().names if each.name == "Jay"]
    assert named.artist_ids == (_artist_id(units, rap),)
    assert named.artist_id == JAY_RAPPER.id


def test_keeping_a_name_as_one_artist_stops_it_waiting_until_forgotten(
    enriching: Enriching, alice: Account, shared: SharedNameService
) -> None:
    _two_jays(enriching)
    _looked_up(enriching, alice, "Jay")

    shared.keep(["Jay"])
    kept = _shared(shared, "Jay")
    shared.forget(["jay"])

    assert (kept.kept, kept.waiting) == (True, False)
    assert _shared(shared, "Jay").waiting


def test_a_name_naming_several_artists_waits_for_the_albums_not_chosen_for(
    enriching: Enriching, units: sessionmaker[Session], shared: SharedNameService
) -> None:
    fantasy_one, fantasy_two, rap = _two_jays(enriching)

    enriching.details.choose_artist(rap, "Jay", None)

    named = _shared(shared, "Jay")
    assert (named.known, named.waiting) == ((), True)
    assert len(named.artists) == 2
    assert _album(named, "Rap Tape").confirmed
    assert _album(named, "范特西").track_ids == (fantasy_one, fantasy_two)
    assert not _album(named, "范特西").confirmed
    assert _album(named, "范特西").artist_id == _artist_id(units, fantasy_one)


def test_choosing_for_a_song_not_writing_the_name_is_refused(
    enriching: Enriching, alice: Account, shared: SharedNameService
) -> None:
    _two_jays(enriching)
    other = enriching.add_song("Yesterday", artist="披头士")

    with pytest.raises(InvalidInputError):
        shared.assign("Jay", [SongsBy((other,), musicbrainz_id=BEATLES.id)])


def test_choosing_an_artist_the_name_does_not_name_is_not_found(
    enriching: Enriching, shared: SharedNameService
) -> None:
    songs = _two_jays(enriching)

    with pytest.raises(NotFoundError):
        shared.assign("Jay", [SongsBy(songs, artist_id="0" * 32)])


def test_choosing_an_artist_musicbrainz_never_named_is_not_found(
    enriching: Enriching, shared: SharedNameService
) -> None:
    songs = _two_jays(enriching)

    with pytest.raises(NotFoundError):
        shared.assign("Jay", [SongsBy(songs, musicbrainz_id=JAY_RAPPER.id)])
