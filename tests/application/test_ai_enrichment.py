"""Suggesting a Track's details with an AI model in real Jobs, through the test plugin `reader`."""

import logging
import time
from collections.abc import Iterator
from datetime import timedelta
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.accounts import AccountService
from medleyplay.application.enrichment import ENRICH_KIND, EnrichmentService, enrich_target
from medleyplay.application.segments import SongsService
from medleyplay.domain.accounts import Account
from medleyplay.domain.catalog import TrackId
from medleyplay.domain.details import Field, Origin
from medleyplay.domain.enrichers import AI_DETAILS, ASK_AGAIN_AFTER
from medleyplay.domain.errors import ConflictError, ForbiddenError, PluginUnavailableError
from medleyplay.domain.jobs import JobState, JobView
from medleyplay.domain.segments import SongRow
from medleyplay.domain.video_text import Chapter, Song, VideoText
from medleyplay.persistence.schema import AiSuggestionRow, EnricherAskRow
from tests.support.ai import DEEPSEEK, KEY
from tests.support.enrichment import AI_PAUSE, SETTLE, Enriching, running_enrichment
from tests.support.factories import NewAccountFactory
from tests.support.fakes import FakeClock
from tests.support.hosts import started_plugins

NAME = AI_DETAILS.name
NIGHT_DRIVE_SUGGESTION = {
    Field.TITLE: "Night Drive",
    Field.ARTIST: "Blue Room",
    Field.ALBUM: "Re:Start",
    Field.YEAR: 2016,
}


@pytest.fixture
def alice(accounts: AccountService) -> Account:
    return accounts.create_first_admin(NewAccountFactory.admin()).account


@pytest.fixture
def bob(accounts: AccountService, alice: Account) -> Account:
    return accounts.create_account(alice, NewAccountFactory.member())


@pytest.fixture
def enriching(
    units: sessionmaker[Session], clock: FakeClock, tmp_path: Path, alice: Account
) -> Iterator[Enriching]:
    """The services around a running `reader` plugin, with Alice having set DeepSeek up."""
    with running_enrichment(units, clock, tmp_path / "data") as running:
        running.ai.save(alice, DEEPSEEK, "deepseek-flash", KEY)
        yield running


def _suggested(enriching: Enriching, who: Account, track_id: TrackId) -> JobView:
    """Ask the AI about the Track, and wait for the Job to succeed."""
    job = enriching.enrichment.find_details(who, track_id, NAME)
    return enriching.wait_for(job.id, JobState.SUCCEEDED)


def _failed(enriching: Enriching, who: Account, track_id: TrackId) -> JobView:
    """Ask the AI about the Track, and wait for the Job to fail."""
    job = enriching.enrichment.find_details(who, track_id, NAME)
    return enriching.wait_for(job.id, JobState.FAILED)


def _suggestion(enriching: Enriching, track_id: TrackId) -> dict[Field, str | int]:
    return enriching.details.details(track_id).values.get(Origin.AI, {})


def _suggested_songs(enriching: Enriching, track_id: TrackId) -> list[tuple[int, str, str]]:
    with enriching.units() as db:
        row = db.get(AiSuggestionRow, track_id)
        if row is None:
            return []
        return [
            (int(each["start_ms"]), str(each["title"]), str(each["artist"])) for each in row.songs
        ]


# What is recorded


def test_the_answer_is_recorded_under_the_ai_origin_as_a_suggestion(
    enriching: Enriching, alice: Account
) -> None:
    track_id = enriching.add_track_with_text("Night Drive")

    _suggested(enriching, alice, track_id)

    assert _suggestion(enriching, track_id) == NIGHT_DRIVE_SUGGESTION


def test_a_suggestion_changes_nothing_a_track_shows(enriching: Enriching, alice: Account) -> None:
    track_id = enriching.add_track_with_text("Night Drive")
    before = enriching.details.details(track_id).shown

    _suggested(enriching, alice, track_id)

    after = enriching.details.details(track_id)
    assert after.shown == before
    assert enriching.catalog.get_track(alice.id, track_id).details.artist == ""
    assert Origin.AI not in {each.origin for each in after.shown.values()}


def test_the_songs_the_ai_suggests_are_kept_for_the_songs_editor(
    enriching: Enriching, alice: Account
) -> None:
    track_id = enriching.add_track_with_text("Album")

    _suggested(enriching, alice, track_id)

    assert _suggested_songs(enriching, track_id) == [
        (0, "Intro", ""),
        (192_000, "Night Drive", "Blue Room"),
        (4_060_000, "Outro", ""),
    ]
    songs = SongsService(enriching.units, enriching.clock).songs(track_id)
    assert songs.suggested == (
        Song(0, "Intro"),
        Song(192_000, "Night Drive", "Blue Room"),
        Song(4_060_000, "Outro"),
    )


def test_a_song_list_that_is_no_song_list_is_not_kept_but_the_values_are(
    enriching: Enriching, alice: Account
) -> None:
    track_id = enriching.add_track_with_text("BadSongs")

    _suggested(enriching, alice, track_id)

    assert _suggestion(enriching, track_id) == {Field.TITLE: "Night Drive"}
    assert _suggested_songs(enriching, track_id) == []


def test_a_later_suggestion_replaces_the_earlier_one(
    enriching: Enriching, alice: Account, clock: FakeClock
) -> None:
    track_id = enriching.add_track_with_text("Album")
    _suggested(enriching, alice, track_id)
    clock.advance(ASK_AGAIN_AFTER)
    enriching.details.read_video_text(track_id, _text("Night Drive"))

    _suggested(enriching, alice, track_id)

    assert _suggestion(enriching, track_id) == NIGHT_DRIVE_SUGGESTION
    assert _suggested_songs(enriching, track_id) == []


def test_an_answer_that_suggests_nothing_clears_the_earlier_suggestion(
    enriching: Enriching, alice: Account, clock: FakeClock
) -> None:
    track_id = enriching.add_track_with_text("Album")
    _suggested(enriching, alice, track_id)
    clock.advance(ASK_AGAIN_AFTER)
    enriching.details.read_video_text(track_id, _text("Nowhere"))

    _suggested(enriching, alice, track_id)

    assert _suggestion(enriching, track_id) == {}
    assert _suggested_songs(enriching, track_id) == []


def test_the_households_values_and_the_other_origins_are_left_as_they_are(
    enriching: Enriching, alice: Account
) -> None:
    track_id = enriching.add_track_with_text("Night Drive")
    enriching.details.put_household(track_id, {"title": "My Night Drive"})
    before = enriching.details.details(track_id).values

    _suggested(enriching, alice, track_id)

    after = enriching.details.details(track_id).values
    assert {origin: values for origin, values in after.items() if origin is not Origin.AI} == before


def _text(title: str) -> VideoText:
    return VideoText(title, "")


# What the AI is asked with


def test_the_job_is_lent_the_provider_with_its_key_the_text_and_the_file_name(
    enriching: Enriching, alice: Account
) -> None:
    track_id = enriching.add_track_with_text("Echo", "x" * 40, name="BV1dm4y1s7ak.m4a")

    _suggested(enriching, alice, track_id)

    assert _suggestion(enriching, track_id) == {
        Field.ALBUM: f"provider={DEEPSEEK} deepseek-flash key=True text=40 0 file=BV1dm4y1s7ak.m4a"
    }


def test_the_description_is_cut_before_it_is_sent(enriching: Enriching, alice: Account) -> None:
    track_id = enriching.add_track_with_text("Echo", "d" * 7_000)

    _suggested(enriching, alice, track_id)

    assert "text=6000 0" in str(_suggestion(enriching, track_id)[Field.ALBUM])


def test_the_chapters_are_sent_with_the_text(enriching: Enriching, alice: Account) -> None:
    chapters = (Chapter(0, "Intro"), Chapter(60_000, "Outro"))
    track_id = enriching.add_track_with_text("Echo", "-", chapters)

    _suggested(enriching, alice, track_id)

    assert "text=1 2" in str(_suggestion(enriching, track_id)[Field.ALBUM])


def test_the_key_is_in_no_job_row_and_no_view_of_a_job(
    enriching: Enriching, alice: Account, units: sessionmaker[Session]
) -> None:
    track_id = enriching.add_track_with_text("Echo")

    done = _suggested(enriching, alice, track_id)

    with units() as db:
        stored = db.execute(text("SELECT * FROM job")).all()
    assert KEY not in repr(stored)
    assert KEY not in repr(done)


def test_a_local_provider_without_a_key_is_lent_with_none(
    enriching: Enriching, alice: Account
) -> None:
    enriching.ai.save(alice, "http://127.0.0.1:11434/v1", "llama3.2", None)
    enriching.ai.remove_key(alice)
    track_id = enriching.add_track_with_text("Echo")

    _suggested(enriching, alice, track_id)

    assert "key=False" in str(_suggestion(enriching, track_id)[Field.ALBUM])


# Who may ask, and for which Tracks


def test_a_track_with_video_text_from_the_household_is_eligible(
    enriching: Enriching,
) -> None:
    track_id = enriching.add_track_with_text("Night Drive")

    assert enriching.enrichment.eligible(NAME) == [track_id]


def test_a_track_with_no_video_text_is_not_eligible_and_says_why(
    enriching: Enriching, alice: Account
) -> None:
    track_id = enriching.add_file_track("Night Drive.m4a")

    assert enriching.enrichment.eligible(NAME) == []
    with pytest.raises(ConflictError, match="no video text"):
        enriching.enrichment.find_details(alice, track_id, NAME)


def test_a_song_inside_a_longer_file_is_not_eligible(enriching: Enriching, alice: Account) -> None:
    album = enriching.add_track_with_text("Night Drive")
    SongsService(enriching.units, enriching.clock).save(
        album, [_row(0, "Intro"), _row(60_000, "Outro")]
    )
    with enriching.units() as db:
        song = db.execute(text("SELECT track_id FROM segment ORDER BY position")).scalars().first()
    assert song is not None

    with pytest.raises(ConflictError, match="longer file"):
        enriching.enrichment.find_details(alice, TrackId(song), NAME)
    assert enriching.enrichment.eligible(NAME) == [album]


def _row(start_ms: int, title: str) -> SongRow:
    return SongRow(None, Song(start_ms, title))


def test_nothing_is_eligible_until_the_provider_is_set_up(
    enriching: Enriching, alice: Account
) -> None:
    enriching.ai.remove(alice)
    track_id = enriching.add_track_with_text("Night Drive")

    assert enriching.enrichment.eligible(NAME) == []
    with pytest.raises(ConflictError, match="not set up"):
        enriching.enrichment.find_details(alice, track_id, NAME)
    assert enriching.enrichment.find_details_for_all(alice, NAME) == 0


def test_removing_the_provider_fails_a_queued_job_instead_of_asking(
    enriching: Enriching, alice: Account
) -> None:
    enriching.online.online = False
    track_id = enriching.add_track_with_text("Night Drive")
    job = enriching.enrichment.find_details(alice, track_id, NAME)
    enriching.ai.remove(alice)

    enriching.online.online = True
    enriching.runner.wake()
    failed = enriching.wait_for(job.id, JobState.FAILED)

    assert "not set up" in failed.job.failure_message
    assert _suggestion(enriching, track_id) == {}


def test_a_track_is_asked_of_the_ai_once_a_day(
    enriching: Enriching, alice: Account, clock: FakeClock
) -> None:
    track_id = enriching.add_track_with_text("Night Drive")
    other = enriching.add_track_with_text("Album")
    _suggested(enriching, alice, track_id)

    assert enriching.enrichment.eligible(NAME) == [other]
    with pytest.raises(ConflictError, match="24 hours"):
        enriching.enrichment.find_details(alice, track_id, NAME)
    clock.advance(ASK_AGAIN_AFTER)
    assert enriching.enrichment.eligible(NAME) == [track_id, other]


def test_pasting_other_text_makes_a_track_eligible_again_at_once(
    enriching: Enriching, alice: Account
) -> None:
    track_id = enriching.add_track_with_text("Night Drive")
    _suggested(enriching, alice, track_id)

    enriching.details.read_video_text(track_id, _text("Album"))

    assert enriching.enrichment.eligible(NAME) == [track_id]


def test_the_same_text_is_asked_about_once_a_day(enriching: Enriching, alice: Account) -> None:
    track_id = enriching.add_track_with_text("Night Drive")
    _suggested(enriching, alice, track_id)

    enriching.details.read_video_text(track_id, _text("Night Drive"))

    assert enriching.enrichment.eligible(NAME) == []


def test_an_ask_notes_the_track_and_its_text_as_one_subject(
    enriching: Enriching, alice: Account
) -> None:
    track_id = enriching.add_track_with_text("Night Drive")
    _suggested(enriching, alice, track_id)

    with enriching.units() as db:
        rows = db.query(EnricherAskRow).all()

    assert [(row.enricher, len(row.subject)) for row in rows] == [(NAME, 64)]


def test_any_signed_in_account_asks_about_one_track(enriching: Enriching, bob: Account) -> None:
    track_id = enriching.add_track_with_text("Night Drive")

    done = _suggested(enriching, bob, track_id)

    assert done.job.requested_by == bob.id


def test_an_admin_queues_every_eligible_track_and_is_told_how_many(
    enriching: Enriching, alice: Account
) -> None:
    enriching.add_track_with_text("Night Drive")
    enriching.add_track_with_text("Album")
    enriching.add_file_track("No Text.m4a")

    queued = enriching.enrichment.find_details_for_all(alice, NAME)

    assert queued == 2
    enriching.finish_every_job()


def test_a_member_cannot_ask_for_every_track(enriching: Enriching, bob: Account) -> None:
    with pytest.raises(ForbiddenError):
        enriching.enrichment.find_details_for_all(bob, NAME)


def test_nothing_is_asked_unless_someone_asks(
    enriching: Enriching, alice: Account, clock: FakeClock
) -> None:
    enriching.add_track_with_text("Night Drive")
    enriching.ai.save(alice, DEEPSEEK, "deepseek-reasoner", None)
    clock.advance(timedelta(days=3))
    time.sleep(SETTLE)

    assert enriching.jobs.list_jobs() == []


def test_the_enricher_is_off_when_its_plugin_is_off(
    units: sessionmaker[Session], clock: FakeClock, tmp_path: Path, alice: Account
) -> None:
    with (
        started_plugins(units, clock, "tinytag-tags") as plugins,
        running_enrichment(units, clock, tmp_path / "data") as running,
    ):
        running.ai.save(alice, DEEPSEEK, "deepseek-flash", KEY)
        track_id = running.add_track_with_text("Night Drive")
        off = EnrichmentService(units, clock, plugins, running.jobs, running.kind)

        assert off.state(NAME).available is False
        with pytest.raises(PluginUnavailableError):
            off.find_details(alice, track_id, NAME)


# How the Jobs run


def test_the_jobs_of_the_ai_run_one_at_a_time_two_seconds_apart(
    enriching: Enriching, alice: Account
) -> None:
    first = enriching.add_track_with_text("Night Drive")
    second = enriching.add_track_with_text("Album")
    job_1 = enriching.enrichment.find_details(alice, first, NAME)
    job_2 = enriching.enrichment.find_details(alice, second, NAME)

    enriching.wait_for(job_1.id, JobState.SUCCEEDED)
    time.sleep(SETTLE)
    during_the_pause = enriching.jobs.get_job(job_2.id).job.state
    enriching.clock.advance(AI_PAUSE - timedelta(seconds=1))
    enriching.runner.wake()
    time.sleep(SETTLE)
    just_before_it_ends = enriching.jobs.get_job(job_2.id).job.state
    enriching.clock.advance(timedelta(seconds=1))
    enriching.runner.wake()
    enriching.wait_for(job_2.id, JobState.SUCCEEDED)

    assert (during_the_pause, just_before_it_ends) == (JobState.QUEUED, JobState.QUEUED)


def test_the_lane_of_the_ai_is_apart_from_the_other_enrichers(
    enriching: Enriching, alice: Account
) -> None:
    track_id = enriching.add_track_with_text("Night Drive")
    other = enriching.add_site_track("BVSlow")
    slow = enriching.enrichment.find_details(alice, other, "bilibili-details")
    suggestion = enriching.enrichment.find_details(alice, track_id, NAME)

    enriching.wait_for(slow.id, JobState.RUNNING)
    enriching.wait_for(suggestion.id, JobState.SUCCEEDED)


def test_offline_the_job_waits_and_asks_the_provider_once_online(
    enriching: Enriching, alice: Account
) -> None:
    enriching.online.online = False
    track_id = enriching.add_track_with_text("Night Drive")

    job = enriching.enrichment.find_details(alice, track_id, NAME)
    time.sleep(SETTLE)
    waiting = enriching.jobs.get_job(job.id)
    enriching.online.online = True
    enriching.runner.wake()
    enriching.wait_for(job.id, JobState.SUCCEEDED)

    assert (waiting.job.state, waiting.waits_for_online) == (JobState.QUEUED, True)


# What the provider answers


def test_a_key_the_provider_refuses_stops_the_enricher_and_says_to_check_the_key(
    enriching: Enriching, alice: Account
) -> None:
    refused = enriching.add_track_with_text("Refused")
    behind = enriching.add_track_with_text("Night Drive")
    first = enriching.enrichment.find_details(alice, refused, NAME)
    queued = enriching.enrichment.find_details(alice, behind, NAME)

    failed = enriching.wait_for(first.id, JobState.FAILED)
    stopped = enriching.wait_for(queued.id, JobState.FAILED)

    assert failed.job.failure_kind == "refused"
    assert "Check the key" in failed.job.failure_message
    assert stopped.job.failure_kind == "refused"
    assert "stopped after the AI provider refused a request" in stopped.job.failure_message
    state = enriching.enrichment.state(NAME)
    assert (state.stopped_at is not None, "Check the key" in state.reason) == (True, True)
    assert enriching.enrichment.eligible(NAME) == []


def test_an_admin_resets_the_stopped_enricher_and_the_refused_track_is_eligible_again(
    enriching: Enriching, alice: Account
) -> None:
    refused = enriching.add_track_with_text("Refused")
    _failed(enriching, alice, refused)

    enriching.enrichment.reset(alice, NAME)

    assert enriching.enrichment.eligible(NAME) == [refused]


def test_an_invalid_answer_fails_that_job_alone_without_asking_again(
    enriching: Enriching, alice: Account
) -> None:
    invalid = enriching.add_track_with_text("Invalid")

    failed = _failed(enriching, alice, invalid)

    assert (failed.job.failure_kind, failed.job.attempts) == ("invalid", 0)
    assert enriching.enrichment.state(NAME).stopped_at is None
    assert _suggestion(enriching, invalid) == {}


def test_an_invalid_answer_counts_as_asked_since_the_provider_was_asked(
    enriching: Enriching, alice: Account
) -> None:
    invalid = enriching.add_track_with_text("Invalid")
    _failed(enriching, alice, invalid)

    assert enriching.enrichment.eligible(NAME) == []
    with pytest.raises(ConflictError, match="24 hours"):
        enriching.enrichment.find_details(alice, invalid, NAME)


def test_a_provider_that_cannot_be_reached_waits_and_asks_again_as_a_network_failure(
    enriching: Enriching, alice: Account
) -> None:
    track_id = enriching.add_track_with_text("Down")
    job = enriching.enrichment.find_details(alice, track_id, NAME)

    waiting = enriching.wait_for(
        job.id, JobState.WAITING, until=lambda view: view.job.failure_kind is not None
    )

    assert waiting.job.failure_kind == "network"
    assert enriching.enrichment.state(NAME).stopped_at is None


def test_a_fault_in_the_plugin_fails_that_job_alone_and_asks_again_later(
    enriching: Enriching, alice: Account
) -> None:
    track_id = enriching.add_track_with_text("Broken")
    job = enriching.enrichment.find_details(alice, track_id, NAME)

    queued = enriching.wait_for(
        job.id, JobState.QUEUED, until=lambda view: view.job.failure_kind is not None
    )

    assert queued.job.failure_kind == "plugin"
    assert enriching.enrichment.state(NAME).stopped_at is None


# The key is a secret


def test_a_failure_that_would_show_the_key_shows_it_redacted(
    enriching: Enriching, alice: Account, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    track_id = enriching.add_track_with_text("Leak")
    job = enriching.enrichment.find_details(alice, track_id, NAME)

    waiting = enriching.wait_for(
        job.id, JobState.WAITING, until=lambda view: view.job.failure_kind is not None
    )

    assert KEY not in waiting.job.failure_message
    assert "<redacted>" in waiting.job.failure_message
    assert KEY not in caplog.text


def test_the_key_is_in_no_failure_and_no_log_of_any_job(
    enriching: Enriching, alice: Account, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    for title in ["Refused", "Invalid", "Broken"]:
        track_id = enriching.add_track_with_text(title)
        job = enriching.enrichment.find_details(alice, track_id, NAME)
        enriching.wait_for(job.id, JobState.FAILED, JobState.QUEUED, JobState.WAITING)
        enriching.enrichment.reset(alice, NAME)
        enriching.pause_passes()

    assert KEY not in caplog.text
    with enriching.units() as db:
        assert KEY not in repr(db.execute(text("SELECT failure_message FROM job")).all())


def test_a_keychain_that_does_not_answer_holds_the_job_and_names_the_key(
    enriching: Enriching, alice: Account
) -> None:
    enriching.secrets.unavailable = True
    track_id = enriching.add_track_with_text("Night Drive")

    job = enriching.enrichment.find_details(alice, track_id, NAME)
    waiting = enriching.wait_for(
        job.id, JobState.WAITING, until=lambda view: view.job.failure_kind is not None
    )

    assert waiting.job.failure_kind == "keychain"
    assert "key couldn't be read" in waiting.job.failure_message


def test_the_jobs_of_the_ai_are_the_enrich_kind_with_the_tracks_target(
    enriching: Enriching, alice: Account
) -> None:
    track_id = enriching.add_track_with_text("Night Drive")

    job = enriching.enrichment.find_details(alice, track_id, NAME)

    assert (job.kind, job.target) == (ENRICH_KIND, enrich_target(track_id))
