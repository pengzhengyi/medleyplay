"""Importing an Account's Rate Your Music album ratings, the ratings songs take, and export.

A song the Account hasn't rated itself takes its album's rating, which smart
playlists and the download policy read as the Account's rating of the song.
"""

import csv
import io
import uuid
from pathlib import Path

import pytest
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.accounts import AccountService
from medleyplay.application.catalog import CatalogService
from medleyplay.application.policy_snapshot import read_snapshot
from medleyplay.application.ratings import ImportSummary, PlaylistChange, RatingsService
from medleyplay.domain.accounts import Account
from medleyplay.domain.catalog import PlaylistId, TrackDetails, TrackId
from medleyplay.domain.errors import InvalidInputError
from medleyplay.domain.rules import Match, Rating, Rules
from tests.support.factories import NewAccountFactory, SourceKeyFactory, TrackDetailsFactory
from tests.support.fakes import FakeClock
from tests.support.rym import EXPORT_2020, export_of, row


def _alice_and_bob(accounts: AccountService) -> tuple[Account, Account]:
    """Return Alice, the admin, and Bob, a member."""
    alice = accounts.create_first_admin(NewAccountFactory.admin()).account
    return alice, accounts.create_account(alice, NewAccountFactory.member())


def _add(catalog: CatalogService, part: int, details: TrackDetails) -> TrackId:
    return catalog.add_track(SourceKeyFactory.bilibili(part=part), details)


def _bremen_and_blue(catalog: CatalogService) -> tuple[TrackId, TrackId]:
    """Add *Bremen* by ハチ, which `EXPORT_2020` rates 5 stars, and *Intro* on *Blue*, not in it."""
    return _add(catalog, 1, TrackDetailsFactory.album_file()), _add(
        catalog, 2, TrackDetailsFactory.song()
    )


def _rated_at_least(catalog: CatalogService, account: Account, stars: int) -> PlaylistId:
    playlist_id = PlaylistId(uuid.uuid4())
    rules = Rules(Match.ALL, (Rating("at_least", stars),))
    catalog.put_playlist(account.id, playlist_id, f"{stars} stars", rules=rules)
    return playlist_id


def _unrated(catalog: CatalogService, account: Account) -> PlaylistId:
    playlist_id = PlaylistId(uuid.uuid4())
    rules = Rules(Match.ALL, (Rating("unrated"),))
    catalog.put_playlist(account.id, playlist_id, "To rate", rules=rules)
    return playlist_id


def test_a_song_takes_its_imported_albums_rating_and_keeps_none_of_its_own(
    catalog: CatalogService, accounts: AccountService, ratings: RatingsService
) -> None:
    alice, _ = _alice_and_bob(accounts)
    bremen, blue = _bremen_and_blue(catalog)

    ratings.import_ratings(alice.id, EXPORT_2020.encode())

    tracks = {track.id: track for track in catalog.list_tracks(alice.id)}
    assert (tracks[bremen].rating, tracks[bremen].album_rating) == (None, 5)
    assert tracks[blue].album_rating is None
    assert catalog.get_track(alice.id, bremen).album_rating == 5


def test_smart_playlists_read_a_songs_album_rating_as_its_rating(
    catalog: CatalogService, accounts: AccountService, ratings: RatingsService
) -> None:
    alice, _ = _alice_and_bob(accounts)
    bremen, blue = _bremen_and_blue(catalog)
    loved, to_rate = _rated_at_least(catalog, alice, 4), _unrated(catalog, alice)

    ratings.import_ratings(alice.id, EXPORT_2020.encode())

    assert catalog.get_playlist(alice.id, loved).track_ids == (bremen,)
    assert catalog.get_playlist(alice.id, to_rate).track_ids == (blue,)


def test_a_songs_own_rating_comes_before_its_albums_and_an_import_never_changes_it(
    catalog: CatalogService, accounts: AccountService, ratings: RatingsService
) -> None:
    alice, _ = _alice_and_bob(accounts)
    bremen, _ = _bremen_and_blue(catalog)
    loved = _rated_at_least(catalog, alice, 4)
    catalog.set_rating(alice.id, bremen, 2)

    ratings.import_ratings(alice.id, EXPORT_2020.encode())

    track = catalog.get_track(alice.id, bremen)
    assert (track.rating, track.album_rating) == (2, 5)
    assert catalog.get_playlist(alice.id, loved).track_ids == ()


def test_one_accounts_import_is_its_own(
    catalog: CatalogService, accounts: AccountService, ratings: RatingsService
) -> None:
    alice, bob = _alice_and_bob(accounts)
    bremen, _ = _bremen_and_blue(catalog)

    ratings.import_ratings(alice.id, EXPORT_2020.encode())

    assert catalog.get_track(bob.id, bremen).album_rating is None


def test_the_preview_counts_what_importing_changes_and_changes_nothing(
    catalog: CatalogService, accounts: AccountService, ratings: RatingsService, changes: list[str]
) -> None:
    alice, _ = _alice_and_bob(accounts)
    bremen, _ = _bremen_and_blue(catalog)
    loved, to_rate = _rated_at_least(catalog, alice, 4), _unrated(catalog, alice)
    changes.clear()

    summary = ratings.preview_import(alice.id, EXPORT_2020.encode())

    assert summary == ImportSummary(
        albums=3,
        matched_albums=1,
        songs=1,
        unmatched=(("Tony Allen", "Film of Life"), ("スズム", "八日")),
        playlists=(
            PlaylistChange(loved, "4 stars", joining=1, leaving=0),
            PlaylistChange(to_rate, "To rate", joining=0, leaving=1),
        ),
        replaced_albums=0,
    )
    assert changes == []
    assert catalog.get_track(alice.id, bremen).album_rating is None


def test_importing_answers_what_the_preview_said_and_tells_the_catalog_changed(
    catalog: CatalogService, accounts: AccountService, ratings: RatingsService, changes: list[str]
) -> None:
    alice, _ = _alice_and_bob(accounts)
    _bremen_and_blue(catalog)
    _rated_at_least(catalog, alice, 4)
    previewed = ratings.preview_import(alice.id, EXPORT_2020.encode())
    changes.clear()

    imported = ratings.import_ratings(alice.id, EXPORT_2020.encode())

    assert imported == previewed
    assert changes == ["catalog"]


def test_importing_the_same_export_again_changes_nothing(
    catalog: CatalogService, accounts: AccountService, ratings: RatingsService
) -> None:
    alice, _ = _alice_and_bob(accounts)
    bremen, _ = _bremen_and_blue(catalog)
    ratings.import_ratings(alice.id, EXPORT_2020.encode())

    again = ratings.import_ratings(alice.id, EXPORT_2020.encode())

    assert (again.songs, again.replaced_albums) == (0, 3)
    assert catalog.get_track(alice.id, bremen).album_rating == 5


def test_importing_again_replaces_the_earlier_import(
    catalog: CatalogService, accounts: AccountService, ratings: RatingsService
) -> None:
    alice, _ = _alice_and_bob(accounts)
    bremen, blue = _bremen_and_blue(catalog)
    ratings.import_ratings(alice.id, EXPORT_2020.encode())

    ratings.import_ratings(alice.id, export_of(row(last="The Band", title="Blue", rating="6")))

    assert catalog.get_track(alice.id, bremen).album_rating is None
    assert catalog.get_track(alice.id, blue).album_rating == 3


def test_an_export_with_no_album_rated_or_reviewed_is_refused_and_the_earlier_import_kept(
    catalog: CatalogService, accounts: AccountService, ratings: RatingsService
) -> None:
    alice, _ = _alice_and_bob(accounts)
    bremen, _ = _bremen_and_blue(catalog)
    ratings.import_ratings(alice.id, EXPORT_2020.encode())

    with pytest.raises(InvalidInputError, match="no album"):
        ratings.import_ratings(alice.id, export_of(row(rating="0")))

    assert catalog.get_track(alice.id, bremen).album_rating == 5


def test_forgetting_the_import_takes_every_album_rating_away(
    catalog: CatalogService, accounts: AccountService, ratings: RatingsService, changes: list[str]
) -> None:
    alice, _ = _alice_and_bob(accounts)
    bremen, _ = _bremen_and_blue(catalog)
    loved = _rated_at_least(catalog, alice, 4)
    ratings.import_ratings(alice.id, EXPORT_2020.encode())
    changes.clear()

    ratings.forget_import(alice.id)

    assert catalog.get_track(alice.id, bremen).album_rating is None
    assert catalog.get_playlist(alice.id, loved).track_ids == ()
    assert changes == ["catalog"]


def test_an_albums_imported_rating_and_review_are_found_by_its_library_name(
    accounts: AccountService, ratings: RatingsService
) -> None:
    alice, bob = _alice_and_bob(accounts)
    ratings.import_ratings(alice.id, EXPORT_2020.encode())

    found = ratings.album_rating(alice.id, "Tony Allen", "Film of Life")

    assert found is not None
    assert (found.stars, found.note) == (4, "Warm & loose.")
    assert ratings.album_rating(alice.id, "Tony Allen", "Lagos No Shaking") is None
    assert ratings.album_rating(bob.id, "Tony Allen", "Film of Life") is None


def test_the_export_lists_the_songs_rated_then_the_albums_rated(
    catalog: CatalogService, accounts: AccountService, ratings: RatingsService
) -> None:
    alice, _ = _alice_and_bob(accounts)
    _, blue = _bremen_and_blue(catalog)
    catalog.set_rating(alice.id, blue, 3)
    ratings.import_ratings(alice.id, EXPORT_2020.encode())

    exported = ratings.export(alice.id).text

    assert list(csv.reader(io.StringIO(exported))) == [
        ["Rated", "Artist", "Album", "Title", "Stars", "Review"],
        ["song", "The Band", "Blue", "Intro", "3", ""],
        ["album", "ハチ", "Bremen", "", "5", ""],
        ["album", "Tony Allen", "Film of Life", "", "4", "Warm & loose."],
        ["album", "スズム", "八日", "", "1", ""],
    ]


@pytest.mark.parametrize("written", ["=1+1", "+1", "-1", "@SUM(A1)", "\t=1", " =1"])
def test_the_export_keeps_a_spreadsheet_from_running_a_value_as_a_formula(
    accounts: AccountService, ratings: RatingsService, written: str
) -> None:
    alice, _ = _alice_and_bob(accounts)
    ratings.import_ratings(alice.id, export_of(row(title=written)))

    exported = ratings.export(alice.id).text

    assert list(csv.reader(io.StringIO(exported)))[1][2] == f"'{written.strip()}"


def test_the_download_policy_wants_and_keeps_a_song_by_its_album_rating(
    catalog: CatalogService,
    accounts: AccountService,
    ratings: RatingsService,
    units: sessionmaker[Session],
    clock: FakeClock,
    tmp_path: Path,
) -> None:
    alice, _ = _alice_and_bob(accounts)
    bremen, _ = _bremen_and_blue(catalog)
    rules = Rules(Match.ALL, (Rating("at_least", 4),))
    catalog.put_playlist(
        alice.id, PlaylistId(uuid.uuid4()), "Keep", rules=rules, keep_downloaded=True
    )

    ratings.import_ratings(alice.id, EXPORT_2020.encode())

    with units() as db:
        wanted = read_snapshot(db, clock.now, None, ["bilibili"], tmp_path).state.wanted
    assert [(each.track_id, each.standing.best_rating) for each in wanted] == [(bremen, 5)]
