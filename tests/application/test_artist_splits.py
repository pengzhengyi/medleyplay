"""Artist names written as several: offered in Clean up, split into each artist, or kept."""

from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.accounts import AccountService
from medleyplay.application.artist_splits import ArtistSplitService, SplitDecision, SplitOffer
from medleyplay.application.track_artists import BoundArtist, artists_of
from medleyplay.domain.accounts import Account
from medleyplay.domain.artist_split import Credit, Role
from medleyplay.domain.catalog import TrackId
from tests.support.enrichment import Enriching, running_enrichment
from tests.support.factories import NewAccountFactory
from tests.support.fakes import FakeClock

BEATLES = "b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d"


@pytest.fixture
def enriching(
    units: sessionmaker[Session], clock: FakeClock, tmp_path: Path
) -> Iterator[Enriching]:
    with running_enrichment(units, clock, tmp_path / "data") as running:
        yield running


@pytest.fixture
def splits(
    units: sessionmaker[Session], clock: FakeClock, changes: list[str]
) -> ArtistSplitService:
    return ArtistSplitService(units, clock, changes.append)


@pytest.fixture
def alice(accounts: AccountService) -> Account:
    return accounts.create_first_admin(NewAccountFactory.admin()).account


def _artists(units: sessionmaker[Session], track_id: TrackId) -> tuple[BoundArtist, ...]:
    with units() as db:
        return artists_of(db, track_id).artists


def test_names_written_as_several_artists_are_offered_with_their_songs_most_songs_first(
    enriching: Enriching, splits: ArtistSplitService
) -> None:
    enriching.add_song("Melt", artist="GUMI/MAYU")
    enriching.add_song("Smile", artist="スズム feat. GUMI")
    enriching.add_song("Mind Brand", artist="gumi/mayu")
    enriching.add_song("Thunderstruck", artist="AC/DC")

    offers = splits.offers()

    assert offers == (
        SplitOffer("GUMI/MAYU", (Credit("GUMI"), Credit("MAYU")), songs=2),
        SplitOffer("スズム feat. GUMI", (Credit("スズム"), Credit("GUMI", Role.FEATURED)), songs=1),
    )


def test_splitting_a_name_binds_each_of_its_songs_to_each_artist_it_lists(
    enriching: Enriching, splits: ArtistSplitService, units: sessionmaker[Session]
) -> None:
    duet = enriching.add_song("Melt", artist="GUMI/MAYU")
    solo = enriching.add_song("Smile", artist="GUMI")

    splits.split(["GUMI/MAYU"])

    [gumi] = _artists(units, solo)
    assert [(each.written, each.role) for each in _artists(units, duet)] == [
        ("GUMI", Role.MAIN),
        ("MAYU", Role.MAIN),
    ]
    assert _artists(units, duet)[0].artist_id == gumi.artist_id


def test_splitting_a_name_credits_the_artists_it_features_as_featured(
    enriching: Enriching, splits: ArtistSplitService, units: sessionmaker[Session]
) -> None:
    song = enriching.add_song("Smile", artist="スズム feat. GUMI")

    splits.split(["スズム feat. GUMI"])

    assert [(each.written, each.role) for each in _artists(units, song)] == [
        ("スズム", Role.MAIN),
        ("GUMI", Role.FEATURED),
    ]


def test_a_name_split_or_kept_is_offered_no_more_and_kept_names_one_artist(
    enriching: Enriching, splits: ArtistSplitService, units: sessionmaker[Session]
) -> None:
    kept = enriching.add_song("Melt", artist="GUMI/MAYU")
    enriching.add_song("Smile", artist="スズム feat. GUMI")

    splits.keep(["GUMI/MAYU"])
    splits.split(["スズム feat. GUMI"])

    assert splits.offers() == ()
    assert [each.written for each in _artists(units, kept)] == ["GUMI/MAYU"]


def test_a_song_added_under_a_name_split_before_is_bound_to_each_artist(
    enriching: Enriching, splits: ArtistSplitService, units: sessionmaker[Session]
) -> None:
    enriching.add_song("Melt", artist="GUMI/MAYU")
    splits.split(["GUMI/MAYU"])

    added = enriching.add_song("Mind Brand", artist="gumi/mayu")

    assert [each.written for each in _artists(units, added)] == ["gumi", "mayu"]


def test_an_album_artist_written_as_several_is_split_with_the_name(
    enriching: Enriching, splits: ArtistSplitService, units: sessionmaker[Session]
) -> None:
    song = enriching.add_song("Melt", artist="GUMI", album_artist="GUMI/MAYU")

    splits.split(["GUMI/MAYU"])

    with units() as db:
        album_artists = artists_of(db, song).album_artists
    assert [each.written for each in album_artists] == ["GUMI", "MAYU"]


def test_a_name_linked_to_one_musicbrainz_artist_is_offered_saying_so(
    enriching: Enriching, splits: ArtistSplitService, alice: Account
) -> None:
    enriching.add_song("Yesterday", artist="披头士/甲壳虫")
    enriching.artists.look_up(alice, ["披头士/甲壳虫"])
    enriching.finish_every_job()

    enriching.artists.link(alice, "披头士/甲壳虫", BEATLES)

    [offer] = splits.offers()
    assert (offer.written, offer.linked) == ("披头士/甲壳虫", True)


def test_a_name_to_tidy_first_is_not_offered(
    enriching: Enriching, splits: ArtistSplitService
) -> None:
    enriching.add_song("Melt", artist="GUMI/MAYU 2014年发行")

    assert splits.offers() == ()


def test_a_decision_is_listed_and_forgetting_it_offers_the_name_again_as_written(
    enriching: Enriching, splits: ArtistSplitService, units: sessionmaker[Session]
) -> None:
    song = enriching.add_song("Melt", artist="GUMI/MAYU")
    splits.split(["GUMI/MAYU"])

    decided = splits.decided()
    splits.forget(["GUMI/MAYU"])

    assert decided == (SplitDecision("GUMI/MAYU", split=True),)
    assert [offer.written for offer in splits.offers()] == ["GUMI/MAYU"]
    assert [each.written for each in _artists(units, song)] == ["GUMI/MAYU"]


def test_deciding_names_says_the_library_changed_once(
    enriching: Enriching, splits: ArtistSplitService, changes: list[str]
) -> None:
    enriching.add_song("Melt", artist="GUMI/MAYU")
    enriching.add_song("Smile", artist="スズム feat. GUMI")
    changes.clear()

    splits.split(["GUMI/MAYU", "スズム feat. GUMI"])

    assert changes == ["catalog"]


def test_each_artist_of_a_split_name_is_listed_to_link_on_its_own(
    enriching: Enriching, splits: ArtistSplitService
) -> None:
    enriching.add_song("Melt", artist="GUMI/MAYU")
    enriching.add_song("Smile", artist="GUMI")

    splits.split(["GUMI/MAYU"])

    names = enriching.artists.names().names
    assert [(each.name, each.tracks) for each in names] == [("GUMI", 2), ("MAYU", 1)]
