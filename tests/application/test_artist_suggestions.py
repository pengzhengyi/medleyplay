"""What an AI model suggests for an artist: the name to show it by, and a note about it.

A suggestion is only offered; the household chooses what to keep. It is kept until it
is asked for again, and a name it suggests stops standing once the artist no longer
goes by it.
"""

from collections.abc import Iterator
from dataclasses import replace
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.accounts import AccountService
from medleyplay.application.artists import ArtistSuggestion, SuggestionState
from medleyplay.domain.accounts import Account
from medleyplay.domain.errors import ConflictError, NotFoundError
from medleyplay.domain.jobs import JobState
from medleyplay.persistence.schema import JobRow
from tests.support.ai import DEEPSEEK
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
    """The Library with 披头士 linked to The Beatles, and DeepSeek set up to ask."""
    with running_enrichment(units, clock, tmp_path / "data") as running:
        running.ai.add(alice, DEEPSEEK, "deepseek-flash", None)
        running.add_song("Yesterday", artist="披头士", album="Help!")
        _linked(running, alice, "披头士")
        yield running


def _linked(enriching: Enriching, alice: Account, name: str) -> None:
    """Look `name` up and link it to The Beatles, waiting for both sites to answer."""
    enriching.artists.look_up(alice, [name])
    enriching.finish_every_job()
    enriching.artists.link(alice, name, BEATLES)
    enriching.finish_every_job()


def _suggested(enriching: Enriching, alice: Account) -> SuggestionState:
    """Ask the AI model about The Beatles, wait until it answered, and return what it said."""
    enriching.artists.suggest(alice, BEATLES)
    enriching.finish_every_job()
    return enriching.artists.suggestion(alice, BEATLES)


def _asked(enriching: Enriching) -> dict[str, object]:
    """The request of the last Job that asked about an artist."""
    with enriching.units() as db:
        row = db.scalars(
            select(JobRow).where(JobRow.kind == "describe_artist").order_by(JobRow.id.desc())
        ).first()
    assert row is not None
    return row.request


def test_an_ai_model_suggests_a_name_to_show_an_artist_by_and_a_note(
    enriching: Enriching, alice: Account, clock: FakeClock
) -> None:
    asked_at = clock()

    state = _suggested(enriching, alice)

    assert (state.asking, state.failure) == (False, None)
    assert state.suggestion is not None
    # The Job answers while the clock steps on, so when is between the asking and now.
    assert asked_at <= state.suggestion.at <= clock()
    assert replace(state.suggestion, at=asked_at) == ArtistSuggestion(
        shown_as="甲壳虫",
        why="Its songs are Chinese",
        about="The Beatles, from GB.",
        model="deepseek-flash",
        host="api.deepseek.com",
        at=asked_at,
    )


def test_the_model_is_offered_the_songs_name_then_musicbrainz_s_then_primary_names_first(
    enriching: Enriching, alice: Account
) -> None:
    _suggested(enriching, alice)

    asked = _asked(enriching)
    assert asked["names"] == [
        "披头士",
        "The Beatles",
        "ビートルズ",
        "Beatles",
        "甲壳虫",
        "Various",
        "甲壳虫乐队",
    ]
    assert asked["songs"] == ["Yesterday — Help!"]


def test_nothing_is_suggested_until_asked(enriching: Enriching, alice: Account) -> None:
    state = enriching.artists.suggestion(alice, BEATLES)

    assert state == SuggestionState(asking=False, suggestion=None, failure=None)


def test_a_name_the_model_was_not_offered_is_no_suggestion_but_its_note_is(
    enriching: Enriching, alice: Account
) -> None:
    enriching.add_song("Forged", artist="披头士")

    state = _suggested(enriching, alice)

    assert state.suggestion is not None
    assert (state.suggestion.shown_as, state.suggestion.about) == (None, "The Beatles, from GB.")


def test_the_provider_refusing_fails_the_job_and_says_why_to_whoever_asked(
    enriching: Enriching, alice: Account
) -> None:
    enriching.add_song("Refused", artist="披头士")

    state = _suggested(enriching, alice)

    jobs = [view.job for view in enriching.jobs.list_jobs() if view.job.kind == "describe_artist"]
    assert [job.state for job in jobs] == [JobState.FAILED]
    assert state.suggestion is None
    assert state.failure == "The key was refused."


def test_an_answer_suggesting_nothing_fails_the_job(enriching: Enriching, alice: Account) -> None:
    enriching.add_song("Silence", artist="披头士")

    state = _suggested(enriching, alice)

    assert state.suggestion is None
    assert state.failure is not None


def test_asking_again_while_the_model_is_asked_is_refused(
    enriching: Enriching, alice: Account
) -> None:
    enriching.artists.suggest(alice, BEATLES)

    with pytest.raises(ConflictError, match="being asked already"):
        enriching.artists.suggest(alice, BEATLES)

    assert enriching.artists.suggestion(alice, BEATLES).asking


def test_an_artist_no_site_named_is_not_asked_about(enriching: Enriching, alice: Account) -> None:
    with pytest.raises(NotFoundError):
        enriching.artists.suggest(alice, "not-an-artist")
    with pytest.raises(NotFoundError):
        enriching.artists.suggestion(alice, "not-an-artist")


def test_an_ai_model_is_asked_only_once_one_is_set_up(enriching: Enriching, alice: Account) -> None:
    for provider in enriching.ai.providers(alice):
        enriching.ai.remove(alice, provider.id)

    with pytest.raises(ConflictError, match="Set up an AI provider"):
        enriching.artists.suggest(alice, BEATLES)


def test_a_name_suggested_stops_standing_once_the_artist_no_longer_goes_by_it(
    enriching: Enriching, alice: Account
) -> None:
    enriching.add_song("Let It Be", artist="披头士乐团")
    enriching.add_song("Help!", artist="披头士")
    _linked(enriching, alice, "披头士乐团")
    suggested = _suggested(enriching, alice).suggestion
    assert suggested is not None
    assert suggested.shown_as == "披头士乐团"

    enriching.artists.unlink("披头士乐团")

    suggestion = enriching.artists.suggestion(alice, BEATLES).suggestion
    assert suggestion is not None
    assert (suggestion.shown_as, suggestion.about) == (None, "The Beatles, from GB.")
