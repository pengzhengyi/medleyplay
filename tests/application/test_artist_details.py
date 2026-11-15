"""What the household chooses for an artist: the name it is shown by, a note, and a photo.

Each is kept apart from what the sites said, so the songs keep their names as
written, and removing the household's photo shows Wikidata's again.
"""

from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.accounts import AccountService
from medleyplay.application.artists import KnownArtist
from medleyplay.domain.accounts import Account
from medleyplay.domain.covers import cover_id
from medleyplay.domain.errors import InvalidInputError, NotFoundError
from tests.support.enrichment import Enriching, running_enrichment
from tests.support.factories import NewAccountFactory
from tests.support.fakes import FakeClock
from tests.support.images import gif_image, png_image
from tests.support.plugins.reader import BEATLES_PHOTO

BEATLES = "b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d"
OWN_PHOTO = png_image("The Beatles, as we like them")


@pytest.fixture
def alice(accounts: AccountService) -> Account:
    return accounts.create_first_admin(NewAccountFactory.admin()).account


@pytest.fixture
def enriching(
    units: sessionmaker[Session], clock: FakeClock, tmp_path: Path, alice: Account
) -> Iterator[Enriching]:
    """The Library with 披头士 linked to The Beatles, whose names and photo Wikidata gave."""
    with running_enrichment(units, clock, tmp_path / "data") as running:
        running.add_song("Yesterday", artist="披头士")
        running.artists.look_up(alice, ["披头士"])
        running.finish_every_job()
        running.artists.link(alice, "披头士", BEATLES)
        running.finish_every_job()
        yield running


def _beatles(enriching: Enriching) -> KnownArtist:
    return enriching.artists.names().artists[BEATLES]


def test_the_name_an_artist_is_shown_by_and_a_note_are_kept(enriching: Enriching) -> None:
    enriching.artists.set_details(BEATLES, shown_as=" 披头士 ", about="Four lads from Liverpool.")

    beatles = _beatles(enriching)
    assert (beatles.shown_as, beatles.about) == ("披头士", "Four lads from Liverpool.")


def test_an_artist_s_details_start_unchosen(enriching: Enriching) -> None:
    beatles = _beatles(enriching)

    assert (beatles.shown_as, beatles.about, beatles.own_photo) == (None, None, False)


def test_emptying_a_detail_forgets_it(enriching: Enriching) -> None:
    enriching.artists.set_details(BEATLES, shown_as="披头士", about="Four lads.")

    enriching.artists.set_details(BEATLES, shown_as="  ", about="")

    beatles = _beatles(enriching)
    assert (beatles.shown_as, beatles.about) == (None, None)


@pytest.mark.parametrize(
    ("shown_as", "about"), [("x" * 513, None), (None, "x" * 1001)], ids=["name", "note"]
)
def test_a_detail_too_long_is_refused(
    enriching: Enriching, shown_as: str | None, about: str | None
) -> None:
    with pytest.raises(InvalidInputError):
        enriching.artists.set_details(BEATLES, shown_as=shown_as, about=about)


def test_an_artist_no_site_named_has_no_details_to_set(enriching: Enriching) -> None:
    with pytest.raises(NotFoundError):
        enriching.artists.set_details("not-an-artist", shown_as="Anyone", about=None)
    with pytest.raises(NotFoundError):
        enriching.artists.set_photo("not-an-artist", OWN_PHOTO)


def test_the_household_s_photo_shows_in_place_of_wikidata_s(enriching: Enriching) -> None:
    enriching.artists.set_photo(BEATLES, OWN_PHOTO)

    beatles = _beatles(enriching)
    assert (beatles.photo, beatles.own_photo) == (cover_id(OWN_PHOTO), True)
    assert beatles.photo_page is None
    assert enriching.covers.open(cover_id(OWN_PHOTO)) is not None


def test_removing_the_household_s_photo_shows_wikidata_s_again(enriching: Enriching) -> None:
    enriching.artists.set_photo(BEATLES, OWN_PHOTO)

    enriching.artists.remove_photo(BEATLES)

    beatles = _beatles(enriching)
    assert (beatles.photo, beatles.own_photo) == (cover_id(BEATLES_PHOTO), False)
    assert beatles.photo_page == "https://commons.wikimedia.org/wiki/File:The_Beatles.jpg"


def test_a_photo_that_is_no_cover_image_is_refused(enriching: Enriching) -> None:
    with pytest.raises(InvalidInputError):
        enriching.artists.set_photo(BEATLES, gif_image())

    assert not _beatles(enriching).own_photo


def test_the_sweep_keeps_the_household_s_photo_of_an_artist(enriching: Enriching) -> None:
    enriching.artists.set_photo(BEATLES, OWN_PHOTO)

    enriching.covers.sweep()

    assert enriching.covers.open(cover_id(OWN_PHOTO)) is not None


def test_choosing_details_changes_no_song(enriching: Enriching) -> None:
    enriching.artists.set_details(BEATLES, shown_as="The Beatles", about=None)

    assert [each.name for each in enriching.artists.names().names] == ["披头士"]
