"""Two artists of one name: a name naming several artists, each song bound to one of them."""

from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.accounts import AccountService
from medleyplay.application.track_artists import Namesake, artists_of
from medleyplay.domain.accounts import Account
from medleyplay.domain.catalog import TrackId
from medleyplay.domain.errors import InvalidInputError, NotFoundError
from tests.support.enrichment import Enriching, running_enrichment
from tests.support.factories import NewAccountFactory
from tests.support.fakes import FakeClock

BEATLES = "b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d"


@pytest.fixture
def alice(accounts: AccountService) -> Account:
    return accounts.create_first_admin(NewAccountFactory.admin()).account


@pytest.fixture
def enriching(
    units: sessionmaker[Session], clock: FakeClock, tmp_path: Path
) -> Iterator[Enriching]:
    with running_enrichment(units, clock, tmp_path / "data") as running:
        yield running


def _artist_id(units: sessionmaker[Session], track_id: TrackId) -> str:
    """The id of the one artist the Track shows as its artist."""
    with units() as db:
        [artist] = artists_of(db, track_id).artists
    return artist.artist_id


def _artists_named(enriching: Enriching, name: str) -> tuple[str, ...]:
    """The Library's artists the name names, as the list of artist names shows them."""
    [named] = [each for each in enriching.artists.names().names if each.name == name]
    return named.artist_ids


def test_a_name_names_one_artist_until_a_song_is_another_artist_called_it(
    enriching: Enriching, units: sessionmaker[Session]
) -> None:
    song = enriching.add_song("星晴", artist="Jay", album="Jay")
    first = _artist_id(units, song)

    enriching.details.choose_artist(song, "Jay", None)

    another = _artist_id(units, song)
    assert another != first
    assert _artists_named(enriching, "Jay") == (first, another)


def test_another_artist_called_a_name_takes_only_the_song_it_was_chosen_for(
    enriching: Enriching, units: sessionmaker[Session]
) -> None:
    chosen = enriching.add_song("Blue Night", artist="Jay", album="Blue Night")
    kept = enriching.add_song("Morning", artist="Jay", album="Blue Night")
    first = _artist_id(units, kept)

    enriching.details.choose_artist(chosen, "Jay", None)

    assert _artist_id(units, kept) == first
    assert _artist_id(units, chosen) != first


def test_a_song_added_to_an_album_is_bound_as_the_albums_chosen_songs_are(
    enriching: Enriching, units: sessionmaker[Session]
) -> None:
    chosen = enriching.add_song("Blue Night", artist="Jay", album="Blue Night")
    enriching.details.choose_artist(chosen, "Jay", None)

    added = enriching.add_song("Evening", artist="Jay", album="blue night")

    assert _artist_id(units, added) == _artist_id(units, chosen)


def test_a_song_added_to_an_album_no_song_was_chosen_for_is_bound_to_the_names_first(
    enriching: Enriching, units: sessionmaker[Session]
) -> None:
    first = enriching.add_song("星晴", artist="Jay", album="Jay")
    chosen = enriching.add_song("Blue Night", artist="Jay", album="Blue Night")
    enriching.details.choose_artist(chosen, "Jay", None)

    added = enriching.add_song("龙卷风", artist="Jay", album="Jay")
    alone = enriching.add_song("Single", artist="Jay")

    assert _artist_id(units, added) == _artist_id(units, first)
    assert _artist_id(units, alone) == _artist_id(units, first)


def test_a_song_may_be_bound_to_any_artist_its_name_names(
    enriching: Enriching, units: sessionmaker[Session]
) -> None:
    chosen = enriching.add_song("Blue Night", artist="Jay", album="Blue Night")
    moved = enriching.add_song("Single", artist="Jay")
    enriching.details.choose_artist(chosen, "Jay", None)

    enriching.details.choose_artist(moved, "jay", _artist_id(units, chosen))

    assert _artist_id(units, moved) == _artist_id(units, chosen)


def test_another_artist_called_a_name_leaves_once_no_song_is_bound_to_it(
    enriching: Enriching, units: sessionmaker[Session]
) -> None:
    song = enriching.add_song("Blue Night", artist="Jay", album="Blue Night")
    first = _artist_id(units, song)
    enriching.details.choose_artist(song, "Jay", None)

    enriching.details.choose_artist(song, "Jay", first)

    assert _artist_id(units, song) == first
    assert _artists_named(enriching, "Jay") == (first,)


def test_a_choice_is_forgotten_once_the_song_no_longer_writes_the_name(
    enriching: Enriching, units: sessionmaker[Session]
) -> None:
    song = enriching.add_song("Blue Night", artist="Jay", album="Blue Night")
    first = _artist_id(units, song)
    enriching.details.choose_artist(song, "Jay", None)

    enriching.details.put_household(song, {"artist": "Jay Chou"})
    enriching.details.put_household(song, {"artist": "Jay"})

    assert _artist_id(units, song) == first
    assert _artists_named(enriching, "Jay") == (first,)


def test_choosing_an_artist_the_name_does_not_name_is_refused(
    enriching: Enriching, units: sessionmaker[Session]
) -> None:
    song = enriching.add_song("Blue Night", artist="Jay")
    other = _artist_id(units, enriching.add_song("Creep", artist="Radiohead"))

    with pytest.raises(NotFoundError):
        enriching.details.choose_artist(song, "Jay", other)


def test_choosing_for_a_name_the_song_does_not_write_is_refused(
    enriching: Enriching,
) -> None:
    song = enriching.add_song("Blue Night", artist="Jay")

    with pytest.raises(InvalidInputError):
        enriching.details.choose_artist(song, "Radiohead", None)


def test_a_songs_details_offer_the_other_artists_its_name_names(
    enriching: Enriching, units: sessionmaker[Session]
) -> None:
    first = enriching.add_song("星晴", artist="Jay", album="Jay")
    enriching.add_song("龙卷风", artist="Jay", album="Jay")
    enriching.add_song("简单爱", artist="Jay", album="范特西")
    chosen = enriching.add_song("Blue Night", artist="Jay", album="Blue Night")
    enriching.details.choose_artist(chosen, "Jay", None)

    namesakes = enriching.details.details(chosen).namesakes

    assert namesakes == {
        "jay": (Namesake(_artist_id(units, first), songs=3, albums=("Jay", "范特西")),)
    }


def test_linking_a_name_naming_several_artists_links_its_first(
    enriching: Enriching, units: sessionmaker[Session], alice: Account
) -> None:
    first = enriching.add_song("Yesterday", artist="披头士", album="Help!")
    chosen = enriching.add_song("Tribute", artist="披头士", album="Covers")
    enriching.details.choose_artist(chosen, "披头士", None)
    another = _artist_id(units, chosen)
    enriching.artists.look_up(alice, ["披头士"])
    enriching.finish_every_job()

    enriching.artists.link(alice, "披头士", BEATLES)

    assert enriching.details.details(first).linked[_artist_id(units, first)].musicbrainz_id == (
        BEATLES
    )
    assert _artist_id(units, chosen) == another
    assert another not in enriching.details.details(chosen).linked
