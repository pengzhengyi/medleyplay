"""The Library's artist names: looking each up on MusicBrainz, and linking it to one artist."""

from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.accounts import AccountService
from medleyplay.application.artists import ArtistName
from medleyplay.domain.accounts import Account
from medleyplay.domain.artists import Alias, LookUp
from medleyplay.domain.errors import NotFoundError
from medleyplay.domain.jobs import JobState
from tests.support.enrichment import Enriching, running_enrichment
from tests.support.factories import NewAccountFactory
from tests.support.fakes import FakeClock

BEATLES = "b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d"
TRIBUTE = "6a3b5c1e-0000-4000-8000-0000000b0a1d"


@pytest.fixture
def alice(accounts: AccountService) -> Account:
    return accounts.create_first_admin(NewAccountFactory.admin()).account


@pytest.fixture
def enriching(
    units: sessionmaker[Session], clock: FakeClock, tmp_path: Path
) -> Iterator[Enriching]:
    with running_enrichment(units, clock, tmp_path / "data") as running:
        yield running


def _named(enriching: Enriching, name: str) -> ArtistName:
    """The Library's artist name `name`, as the service lists it."""
    return next(each for each in enriching.artists.names().names if each.name == name)


def _looked_up(enriching: Enriching, alice: Account, *names: str) -> int:
    """Look `names` up, and wait until MusicBrainz has answered each."""
    asked = enriching.artists.look_up(alice, names)
    enriching.finish_every_job()
    return asked


def test_each_artist_name_is_listed_once_with_its_tracks_most_tracks_first(
    enriching: Enriching,
) -> None:
    enriching.add_song("Help!", artist="Beatles")
    enriching.add_song("Yesterday", artist="披头士")
    enriching.add_song("Let It Be", artist="披头士")

    names = enriching.artists.names().names

    assert [(each.name, each.tracks) for each in names] == [("披头士", 2), ("Beatles", 1)]


def test_a_name_looked_up_keeps_what_musicbrainz_knows_and_suggests_the_exact_match(
    enriching: Enriching, alice: Account
) -> None:
    enriching.add_song("Yesterday", artist="披头士")

    asked = _looked_up(enriching, alice, "披头士")

    named = _named(enriching, "披头士")
    assert asked == 1
    assert named.candidates == ((BEATLES, 100), (TRIBUTE, 61))
    assert named.suggested == BEATLES
    assert Alias("甲壳虫", "zh") in enriching.artists.names().artists[BEATLES].aliases


def test_a_name_naming_no_one_or_needing_tidying_is_not_looked_up(
    enriching: Enriching, alice: Account
) -> None:
    enriching.add_song("Mix", artist="群星")
    enriching.add_song("可爱女人", artist="周杰伦2000年发行首张个人")

    asked = enriching.artists.look_up(alice, ["群星", "周杰伦2000年发行首张个人"])

    assert asked == 0
    assert {each.name: each.look_up for each in enriching.artists.names().names} == {
        "群星": LookUp.NEVER,
        "周杰伦2000年发行首张个人": LookUp.TIDY_FIRST,
    }


def test_a_name_musicbrainz_knows_no_artist_by_is_kept_as_looked_up(
    enriching: Enriching, alice: Account, clock: FakeClock
) -> None:
    enriching.add_song("Song", artist="Nobody At All")

    _looked_up(enriching, alice, "Nobody At All")

    named = _named(enriching, "Nobody At All")
    assert (named.candidates, named.suggested, named.looked_at is not None) == ((), None, True)


def test_names_linked_to_one_artist_name_it_and_are_not_looked_up_again(
    enriching: Enriching, alice: Account
) -> None:
    enriching.add_song("Yesterday", artist="披头士")
    enriching.add_song("Help!", artist="甲壳虫")
    _looked_up(enriching, alice, "披头士", "甲壳虫")

    enriching.artists.link("披头士", BEATLES)
    enriching.artists.link("甲壳虫", BEATLES)

    assert [(each.linked, each.artist_id) for each in enriching.artists.names().names] == [
        (True, BEATLES),
        (True, BEATLES),
    ]
    assert enriching.artists.look_up(alice, ["披头士"]) == 0


def test_a_name_linked_to_no_artist_says_so(enriching: Enriching) -> None:
    enriching.add_song("Song", artist="Blue Room")

    enriching.artists.link("Blue Room", None)

    named = _named(enriching, "Blue Room")
    assert (named.linked, named.artist_id) == (True, None)


def test_an_unlinked_name_is_offered_again(enriching: Enriching, alice: Account) -> None:
    enriching.add_song("Yesterday", artist="披头士")
    _looked_up(enriching, alice, "披头士")
    enriching.artists.link("披头士", BEATLES)

    enriching.artists.unlink("披头士")

    named = _named(enriching, "披头士")
    assert (named.linked, named.suggested) == (False, BEATLES)


def test_a_name_is_not_linked_to_an_artist_musicbrainz_never_named(
    enriching: Enriching,
) -> None:
    enriching.add_song("Yesterday", artist="披头士")

    with pytest.raises(NotFoundError):
        enriching.artists.link("披头士", BEATLES)


def test_musicbrainz_refusing_a_look_up_fails_its_job(enriching: Enriching, alice: Account) -> None:
    enriching.add_song("Song", artist="Refuse")

    enriching.artists.look_up(alice, ["Refuse"])

    [job] = [view.job for view in enriching.jobs.list_jobs() if view.job.kind == "find_artist"]
    failed = enriching.wait_for(job.id, JobState.FAILED)
    assert failed.job.failure_kind == "refused"
