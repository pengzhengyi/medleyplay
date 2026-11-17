"""Favorite artists and albums: each Account's own, set as absolute values.

Artists are kept by the id of the Library's artist; albums by name.
"""

import pytest

from medleyplay.application.accounts import AccountService
from medleyplay.application.catalog import CatalogService
from medleyplay.domain.accounts import Account
from medleyplay.domain.catalog import FavoriteAlbum, Favorites, TrackDetails
from medleyplay.domain.errors import InvalidInputError, NotFoundError
from tests.support.factories import NewAccountFactory, SourceKeyFactory


def _alice_and_bob(accounts: AccountService) -> tuple[Account, Account]:
    """Return Alice, the admin, and Bob, a member."""
    alice = accounts.create_first_admin(NewAccountFactory.admin()).account
    return alice, accounts.create_account(alice, NewAccountFactory.member())


def _artist_of_a_song_by(catalog: CatalogService, account: Account, artist: str) -> str:
    """Add a song by `artist`, and return the id of the Library's artist it is bound to."""
    part = len(catalog.list_tracks(account.id)) + 1
    song = catalog.add_track(
        SourceKeyFactory.bilibili(part=part), TrackDetails(title=f"Song {part}", artist=artist)
    )
    [artist_id] = catalog.get_track(account.id, song).artist_ids
    return artist_id


def _full_width(text: str) -> str:
    """Return ASCII `text` in full-width letters, each U+FEE0 above its ASCII letter."""
    return "".join(chr(ord(letter) + 0xFEE0) for letter in text)


def test_an_account_starts_with_no_favorite_artists_or_albums(
    catalog: CatalogService, accounts: AccountService
) -> None:
    alice, _ = _alice_and_bob(accounts)

    assert catalog.favorites(alice.id) == Favorites(artists=(), albums=())


def test_each_account_has_its_own_favorite_artists_and_albums(
    catalog: CatalogService, accounts: AccountService
) -> None:
    alice, bob = _alice_and_bob(accounts)
    pu_shu = _artist_of_a_song_by(catalog, alice, "朴树")

    catalog.set_artist_favorite(alice.id, pu_shu, favorite=True)
    catalog.set_album_favorite(bob.id, "朴树", "生如夏花", favorite=True)

    assert catalog.favorites(alice.id) == Favorites(artists=(pu_shu,), albums=())
    assert catalog.favorites(bob.id) == Favorites(
        artists=(), albums=(FavoriteAlbum(artist="朴树", name="生如夏花"),)
    )


def test_favoriting_twice_or_unfavoriting_what_is_not_a_favorite_leaves_the_same_state(
    catalog: CatalogService, accounts: AccountService
) -> None:
    alice, _ = _alice_and_bob(accounts)
    radiohead = _artist_of_a_song_by(catalog, alice, "Radiohead")

    catalog.set_artist_favorite(alice.id, radiohead, favorite=True)
    catalog.set_artist_favorite(alice.id, radiohead, favorite=True)
    catalog.set_album_favorite(alice.id, "Radiohead", "OK Computer", favorite=False)

    assert catalog.favorites(alice.id) == Favorites(artists=(radiohead,), albums=())


def test_unfavoriting_an_artist_leaves_the_rest(
    catalog: CatalogService, accounts: AccountService
) -> None:
    alice, _ = _alice_and_bob(accounts)
    radiohead = _artist_of_a_song_by(catalog, alice, "Radiohead")
    pu_shu = _artist_of_a_song_by(catalog, alice, "朴树")
    catalog.set_artist_favorite(alice.id, radiohead, favorite=True)
    catalog.set_artist_favorite(alice.id, pu_shu, favorite=True)

    catalog.set_artist_favorite(alice.id, radiohead, favorite=False)

    assert catalog.favorites(alice.id) == Favorites(artists=(pu_shu,), albums=())


def test_an_album_name_differing_only_in_case_or_width_is_the_same_favorite(
    catalog: CatalogService, accounts: AccountService
) -> None:
    alice, _ = _alice_and_bob(accounts)
    catalog.set_album_favorite(alice.id, "Radiohead", "Amnesiac", favorite=True)

    catalog.set_album_favorite(alice.id, "Radiohead", _full_width("AMNESIAC"), favorite=True)
    kept = catalog.favorites(alice.id)
    catalog.set_album_favorite(alice.id, "radiohead", "amnesiac", favorite=False)

    assert kept.albums == (FavoriteAlbum(artist="Radiohead", name=_full_width("AMNESIAC")),)
    assert catalog.favorites(alice.id) == Favorites(artists=(), albums=())


def test_an_album_may_have_no_artist_but_needs_a_name(
    catalog: CatalogService, accounts: AccountService
) -> None:
    alice, _ = _alice_and_bob(accounts)

    catalog.set_album_favorite(alice.id, "", "Field Recordings", favorite=True)

    assert catalog.favorites(alice.id).albums == (
        FavoriteAlbum(artist="", name="Field Recordings"),
    )
    with pytest.raises(InvalidInputError):
        catalog.set_album_favorite(alice.id, "朴树", "  ", favorite=True)


def test_an_artist_no_song_is_bound_to_is_not_found(
    catalog: CatalogService, accounts: AccountService
) -> None:
    alice, _ = _alice_and_bob(accounts)

    with pytest.raises(NotFoundError):
        catalog.set_artist_favorite(alice.id, "0" * 32, favorite=True)


def test_deleting_an_account_deletes_its_favorite_artists_and_albums(
    catalog: CatalogService, accounts: AccountService
) -> None:
    alice, bob = _alice_and_bob(accounts)
    catalog.set_artist_favorite(bob.id, _artist_of_a_song_by(catalog, bob, "朴树"), favorite=True)
    catalog.set_album_favorite(bob.id, "朴树", "生如夏花", favorite=True)

    accounts.delete_account(alice, bob.id)

    assert catalog.favorites(bob.id) == Favorites(artists=(), albums=())
