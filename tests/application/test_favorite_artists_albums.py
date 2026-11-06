"""Favorite artists and albums: each Account's own, kept by name, set as absolute values."""

import pytest

from medleyplay.application.accounts import AccountService
from medleyplay.application.catalog import CatalogService
from medleyplay.domain.accounts import Account
from medleyplay.domain.catalog import FavoriteAlbum, Favorites
from medleyplay.domain.errors import InvalidInputError
from tests.support.factories import NewAccountFactory


def _alice_and_bob(accounts: AccountService) -> tuple[Account, Account]:
    """Return Alice, the admin, and Bob, a member."""
    alice = accounts.create_first_admin(NewAccountFactory.admin()).account
    return alice, accounts.create_account(alice, NewAccountFactory.member())


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

    catalog.set_artist_favorite(alice.id, "朴树", favorite=True)
    catalog.set_album_favorite(bob.id, "朴树", "生如夏花", favorite=True)

    assert catalog.favorites(alice.id) == Favorites(artists=("朴树",), albums=())
    assert catalog.favorites(bob.id) == Favorites(
        artists=(), albums=(FavoriteAlbum(artist="朴树", name="生如夏花"),)
    )


def test_favoriting_twice_or_unfavoriting_what_is_not_a_favorite_leaves_the_same_state(
    catalog: CatalogService, accounts: AccountService
) -> None:
    alice, _ = _alice_and_bob(accounts)

    catalog.set_artist_favorite(alice.id, "Radiohead", favorite=True)
    catalog.set_artist_favorite(alice.id, "Radiohead", favorite=True)
    catalog.set_album_favorite(alice.id, "Radiohead", "OK Computer", favorite=False)

    assert catalog.favorites(alice.id) == Favorites(artists=("Radiohead",), albums=())


def test_a_name_differing_only_in_case_or_width_is_the_same_favorite(
    catalog: CatalogService, accounts: AccountService
) -> None:
    alice, _ = _alice_and_bob(accounts)
    catalog.set_artist_favorite(alice.id, "Radiohead", favorite=True)

    catalog.set_artist_favorite(alice.id, _full_width("RADIOHEAD"), favorite=True)
    kept = catalog.favorites(alice.id)
    catalog.set_artist_favorite(alice.id, "radiohead", favorite=False)

    assert kept == Favorites(artists=(_full_width("RADIOHEAD"),), albums=())
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


@pytest.mark.parametrize("name", ["", "   ", "x" * 513])
def test_an_artist_with_no_name_or_too_long_a_name_is_refused(
    catalog: CatalogService, accounts: AccountService, name: str
) -> None:
    alice, _ = _alice_and_bob(accounts)

    with pytest.raises(InvalidInputError):
        catalog.set_artist_favorite(alice.id, name, favorite=True)


def test_deleting_an_account_deletes_its_favorite_artists_and_albums(
    catalog: CatalogService, accounts: AccountService
) -> None:
    alice, bob = _alice_and_bob(accounts)
    catalog.set_artist_favorite(bob.id, "朴树", favorite=True)
    catalog.set_album_favorite(bob.id, "朴树", "生如夏花", favorite=True)

    accounts.delete_account(alice, bob.id)

    assert catalog.favorites(bob.id) == Favorites(artists=(), albums=())
