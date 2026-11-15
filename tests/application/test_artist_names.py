"""The Library's artist names: looking each up on MusicBrainz, and linking it to one artist."""

from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.accounts import AccountService
from medleyplay.application.artists import ArtistName, Recommendation
from medleyplay.domain.accounts import Account
from medleyplay.domain.artists import Alias, LookUp
from medleyplay.domain.errors import ConflictError, NotFoundError
from medleyplay.domain.jobs import Job, JobState
from tests.support.ai import DEEPSEEK
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


def _linked(enriching: Enriching, alice: Account, name: str, artist_id: str | None) -> None:
    """Link `name` to `artist_id`, and wait until Wikidata has answered for the artist."""
    enriching.artists.link(alice, name, artist_id)
    enriching.finish_every_job()


def _names_jobs(enriching: Enriching) -> list[Job]:
    """The Jobs that asked Wikidata for an artist's names."""
    return [view.job for view in enriching.jobs.list_jobs() if view.job.kind == "find_artist_names"]


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


def test_a_name_written_as_two_is_found_by_its_parts_and_suggested_as_one_artist(
    enriching: Enriching, alice: Account
) -> None:
    enriching.add_song("Yesterday", artist="Beatles/披头士")

    _looked_up(enriching, alice, "Beatles/披头士")

    named = _named(enriching, "Beatles/披头士")
    assert (named.candidates, named.suggested) == (((BEATLES, 100), (TRIBUTE, 61)), BEATLES)


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

    enriching.artists.link(alice, "披头士", BEATLES)
    enriching.artists.link(alice, "甲壳虫", BEATLES)

    assert [(each.linked, each.artist_id) for each in enriching.artists.names().names] == [
        (True, BEATLES),
        (True, BEATLES),
    ]
    assert enriching.artists.look_up(alice, ["披头士"]) == 0


def test_a_name_linked_to_no_artist_says_so(enriching: Enriching, alice: Account) -> None:
    enriching.add_song("Song", artist="Blue Room")

    enriching.artists.link(alice, "Blue Room", None)

    named = _named(enriching, "Blue Room")
    assert (named.linked, named.artist_id) == (True, None)


def test_an_unlinked_name_is_offered_again(enriching: Enriching, alice: Account) -> None:
    enriching.add_song("Yesterday", artist="披头士")
    _looked_up(enriching, alice, "披头士")
    enriching.artists.link(alice, "披头士", BEATLES)

    enriching.artists.unlink("披头士")

    named = _named(enriching, "披头士")
    assert (named.linked, named.suggested) == (False, BEATLES)


def test_a_name_is_not_linked_to_an_artist_musicbrainz_never_named(
    enriching: Enriching, alice: Account
) -> None:
    enriching.add_song("Yesterday", artist="披头士")

    with pytest.raises(NotFoundError):
        enriching.artists.link(alice, "披头士", BEATLES)


def test_musicbrainz_refusing_a_look_up_fails_its_job(enriching: Enriching, alice: Account) -> None:
    enriching.add_song("Song", artist="Refuse")

    enriching.artists.look_up(alice, ["Refuse"])

    [job] = [view.job for view in enriching.jobs.list_jobs() if view.job.kind == "find_artist"]
    failed = enriching.wait_for(job.id, JobState.FAILED)
    assert failed.job.failure_kind == "refused"


def test_linking_a_name_adds_every_name_wikidata_knows_the_artist_by(
    enriching: Enriching, alice: Account
) -> None:
    enriching.add_song("Yesterday", artist="披头士")
    _looked_up(enriching, alice, "披头士")

    _linked(enriching, alice, "披头士", BEATLES)

    aliases = enriching.artists.names().artists[BEATLES].aliases
    assert Alias("甲壳虫乐队", "zh") in aliases
    assert Alias("ビートルズ", "ja", primary=True) in aliases


def test_a_name_both_sites_give_is_kept_once_as_musicbrainz_gives_it(
    enriching: Enriching, alice: Account
) -> None:
    enriching.add_song("Yesterday", artist="披头士")
    _looked_up(enriching, alice, "披头士")

    _linked(enriching, alice, "披头士", BEATLES)

    aliases = enriching.artists.names().artists[BEATLES].aliases
    assert [alias for alias in aliases if alias.name == "Beatles"] == [Alias("Beatles")]


def test_looking_a_name_up_again_keeps_the_names_wikidata_gave(
    enriching: Enriching, alice: Account
) -> None:
    enriching.add_song("Yesterday", artist="披头士")
    enriching.add_song("Help!", artist="Beatles")
    _looked_up(enriching, alice, "披头士")
    _linked(enriching, alice, "披头士", BEATLES)

    _looked_up(enriching, alice, "Beatles")

    assert Alias("甲壳虫乐队", "zh") in enriching.artists.names().artists[BEATLES].aliases


def test_a_linked_name_is_finding_while_wikidata_is_asked_about_its_artist(
    enriching: Enriching, alice: Account
) -> None:
    enriching.add_song("Yesterday", artist="披头士")
    _looked_up(enriching, alice, "披头士")
    enriching.online.online = False

    enriching.artists.link(alice, "披头士", BEATLES)

    assert _named(enriching, "披头士").finding
    enriching.online.online = True
    enriching.finish_every_job()
    assert not _named(enriching, "披头士").finding


def test_wikidata_is_asked_about_an_artist_once(enriching: Enriching, alice: Account) -> None:
    enriching.add_song("Yesterday", artist="披头士")
    enriching.add_song("Help!", artist="甲壳虫")
    _looked_up(enriching, alice, "披头士", "甲壳虫")
    _linked(enriching, alice, "披头士", BEATLES)

    _linked(enriching, alice, "甲壳虫", BEATLES)
    _looked_up(enriching, alice, "Anyone Else")

    assert len(_names_jobs(enriching)) == 1


def test_a_name_an_artist_already_linked_goes_by_is_offered_it_without_asking(
    enriching: Enriching, alice: Account
) -> None:
    enriching.add_song("Yesterday", artist="披头士")
    enriching.add_song("Something", artist="甲壳虫乐队")
    _looked_up(enriching, alice, "披头士")

    _linked(enriching, alice, "披头士", BEATLES)

    named = _named(enriching, "甲壳虫乐队")
    assert (named.looked_at, named.candidates, named.suggested) == (
        None,
        ((BEATLES, 100),),
        BEATLES,
    )


def test_an_artist_already_linked_is_offered_once_beside_what_musicbrainz_found(
    enriching: Enriching, alice: Account
) -> None:
    enriching.add_song("Yesterday", artist="披头士")
    enriching.add_song("Help!", artist="甲壳虫")
    _looked_up(enriching, alice, "披头士", "甲壳虫")

    _linked(enriching, alice, "披头士", BEATLES)

    named = _named(enriching, "甲壳虫")
    assert (named.candidates, named.suggested) == (((BEATLES, 100), (TRIBUTE, 61)), BEATLES)


def test_a_name_naming_no_one_is_offered_no_artist_already_linked(
    enriching: Enriching, alice: Account
) -> None:
    enriching.add_song("Yesterday", artist="披头士")
    enriching.add_song("Mix", artist="Various")
    _looked_up(enriching, alice, "披头士")

    _linked(enriching, alice, "披头士", BEATLES)

    named = _named(enriching, "Various")
    assert named.look_up is LookUp.NEVER

    assert (named.candidates, named.suggested) == ((), None)


def test_wikidata_refusing_fails_the_job_and_leaves_the_artist_to_ask_again(
    enriching: Enriching, alice: Account
) -> None:
    enriching.add_song("Tribute", artist="披头士")
    _looked_up(enriching, alice, "披头士")

    enriching.artists.link(alice, "披头士", TRIBUTE)

    [job] = _names_jobs(enriching)
    failed = enriching.wait_for(job.id, JobState.FAILED)
    assert failed.job.failure_kind == "refused"
    enriching.artists.look_up(alice, ["Anyone Else"])
    assert len(_names_jobs(enriching)) == 2


# What an AI model recommends


def _recommended(enriching: Enriching, alice: Account) -> int:
    """Ask the AI model about the names, and wait until it has answered."""
    asked = enriching.artists.recommend(alice)
    enriching.finish_every_job()
    return asked


def test_an_ai_model_recommends_an_artist_for_each_name_looked_up_and_not_linked(
    enriching: Enriching, alice: Account, clock: FakeClock
) -> None:
    enriching.ai.add(alice, DEEPSEEK, "deepseek-flash", None)
    enriching.add_song("Yesterday", artist="披头士")
    enriching.add_song("Let It Be", artist="Beatles/披头士")
    enriching.add_song("Night Drive", artist="Blue Room")
    _looked_up(enriching, alice, "披头士", "Beatles/披头士")
    _linked(enriching, alice, "Beatles/披头士", BEATLES)

    asked = _recommended(enriching, alice)

    assert asked == 1
    assert _named(enriching, "披头士").recommendation == Recommendation(
        artist_id=BEATLES,
        why="The Beatles, by its songs",
        model="deepseek-flash",
        host="api.deepseek.com",
        at=clock(),
    )
    assert _named(enriching, "Beatles/披头士").recommendation is None
    assert _named(enriching, "Blue Room").recommendation is None


def test_an_ai_model_may_recommend_none_of_the_artists_offered(
    enriching: Enriching, alice: Account
) -> None:
    enriching.ai.add(alice, DEEPSEEK, "deepseek-flash", None)
    enriching.add_song("Tribute Medley", artist="甲壳虫")
    _looked_up(enriching, alice, "甲壳虫")

    _recommended(enriching, alice)

    recommendation = _named(enriching, "甲壳虫").recommendation
    assert recommendation is not None
    assert (recommendation.artist_id, recommendation.why) == (None, "A tribute")


def test_the_ai_provider_refusing_fails_the_job_and_recommends_nothing(
    enriching: Enriching, alice: Account
) -> None:
    enriching.ai.add(alice, DEEPSEEK, "deepseek-flash", None)
    enriching.add_song("Refused", artist="披头士")
    _looked_up(enriching, alice, "披头士")

    _recommended(enriching, alice)

    jobs = [view.job for view in enriching.jobs.list_jobs() if view.job.kind == "choose_artists"]
    assert [job.state for job in jobs] == [JobState.FAILED]
    assert _named(enriching, "披头士").recommendation is None


def test_an_ai_model_is_asked_only_once_one_is_set_up(enriching: Enriching, alice: Account) -> None:
    enriching.add_song("Yesterday", artist="披头士")
    _looked_up(enriching, alice, "披头士")

    with pytest.raises(ConflictError, match="Set up an AI provider"):
        enriching.artists.recommend(alice)
