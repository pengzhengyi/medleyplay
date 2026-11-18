"""Pictures of an artist found on Deezer, to choose the household's photo of it from.

Deezer is asked only once the household turns it on, by the artist's name, in a Job of
its own lane; what it finds is kept as covers are, and nothing changes the artist's
photo until the household uses one.
"""

from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.accounts import AccountService
from medleyplay.application.settings import SettingsService
from medleyplay.domain.accounts import Account
from medleyplay.domain.artists import PictureSite
from medleyplay.domain.errors import ConflictError, NotFoundError
from medleyplay.domain.settings import Settings
from tests.support.enrichment import Enriching, running_enrichment
from tests.support.factories import NewAccountFactory
from tests.support.fakes import FakeClock

BEATLES = "b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d"


@pytest.fixture
def alice(accounts: AccountService) -> Account:
    return accounts.create_first_admin(NewAccountFactory.admin()).account


@pytest.fixture
def enriching(
    units: sessionmaker[Session], clock: FakeClock, tmp_path: Path, alice: Account
) -> Iterator[Enriching]:
    """The Library with 披头士 linked to The Beatles, which Deezer knows by that name."""
    with running_enrichment(units, clock, tmp_path / "data") as running:
        running.add_song("Yesterday", artist="披头士")
        running.artists.look_up(alice, ["披头士"])
        running.finish_every_job()
        running.artists.link(alice, "披头士", BEATLES)
        running.finish_every_job()
        yield running


def _deezer_turned_on(enriching: Enriching, alice: Account) -> None:
    settings = SettingsService(enriching.units, enriching.clock)
    settings.put(alice, Settings(picture_sites=(PictureSite.DEEZER,)))


def test_the_pictures_deezer_has_of_an_artist_are_found_and_kept_most_followed_first(
    enriching: Enriching, alice: Account
) -> None:
    _deezer_turned_on(enriching, alice)

    enriching.artist_pictures.find(alice, BEATLES)
    enriching.finish_every_job()

    found = enriching.artist_pictures.pictures(alice, BEATLES)
    assert [(each.name, each.fans) for each in found.pictures] == [
        ("The Beatles", 4_100_000),
        ("The Beatles", 120),
    ]
    assert all((enriching.data_dir / "covers" / each.cover).is_file() for each in found.pictures)
    assert (found.finding, found.failure, found.found_at is not None) == (False, None, True)


def test_a_picture_found_becomes_the_households_photo_only_when_used(
    enriching: Enriching, alice: Account
) -> None:
    _deezer_turned_on(enriching, alice)
    enriching.artist_pictures.find(alice, BEATLES)
    enriching.finish_every_job()
    picture = enriching.artist_pictures.pictures(alice, BEATLES).pictures[1]
    before = enriching.artists.names().artists[BEATLES].own_photo

    enriching.artists.use_photo(BEATLES, picture.cover)

    beatles = enriching.artists.names().artists[BEATLES]
    assert (before, beatles.own_photo, beatles.photo) == (False, True, picture.cover)


def test_deezer_is_never_asked_until_the_household_turns_it_on(
    enriching: Enriching, alice: Account
) -> None:
    with pytest.raises(ConflictError, match="Turn on Deezer"):
        enriching.artist_pictures.find(alice, BEATLES)

    found = enriching.artist_pictures.pictures(alice, BEATLES)
    assert (found.may_find, found.pictures, found.finding) == (False, (), False)


def test_deezer_refusing_says_why_to_the_account_that_asked(
    enriching: Enriching, alice: Account
) -> None:
    _deezer_turned_on(enriching, alice)
    enriching.artists.set_details(BEATLES, shown_as="Refuse", about="")

    enriching.artist_pictures.find(alice, BEATLES)
    enriching.finish_every_job()

    found = enriching.artist_pictures.pictures(alice, BEATLES)
    assert found.pictures == ()
    assert found.failure is not None
    assert "Deezer refused" in found.failure


def test_an_artist_no_site_named_has_no_pictures_to_find(
    enriching: Enriching, alice: Account
) -> None:
    _deezer_turned_on(enriching, alice)

    with pytest.raises(NotFoundError):
        enriching.artist_pictures.find(alice, "00000000-0000-4000-8000-000000000000")
