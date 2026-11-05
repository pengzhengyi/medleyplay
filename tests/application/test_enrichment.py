"""Finding a Track's details on Bilibili in real Jobs, through the test plugin `reader`."""

import time
from collections.abc import Iterator
from datetime import timedelta
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.accounts import AccountService
from medleyplay.application.details import record_video_text
from medleyplay.application.enrichment import (
    ENRICH_KIND,
    EnrichmentService,
    enrich_target,
    enrich_track_kind,
)
from medleyplay.application.jobs import JobService
from medleyplay.application.plugins import PluginService
from medleyplay.application.segments import SongsService
from medleyplay.domain.accounts import Account
from medleyplay.domain.catalog import TrackId
from medleyplay.domain.covers import cover_id
from medleyplay.domain.details import Field, Origin
from medleyplay.domain.enrichers import ASK_AGAIN_AFTER, BILIBILI_DETAILS
from medleyplay.domain.errors import (
    ConflictError,
    ForbiddenError,
    InvalidInputError,
    NotFoundError,
    PluginUnavailableError,
)
from medleyplay.domain.jobs import JobState, JobView
from medleyplay.domain.segments import SongRow
from medleyplay.domain.video_text import Song, VideoText, read_video
from medleyplay.persistence.schema import EnricherStopRow, VideoAskRow, VideoTextRow
from tests.support.enrichment import PAUSE, SETTLE, Enriching, running_enrichment
from tests.support.factories import NewAccountFactory
from tests.support.fakes import FakeClock
from tests.support.images import jpeg_image
from tests.support.plugins.reader import RECORDED_TITLE

NAME = BILIBILI_DETAILS.name
RECORDED = "BV1AC4y1L7Yi"
"""The video of the recorded answer, which the test plugin answers with its text and a cover."""


@pytest.fixture
def alice(accounts: AccountService) -> Account:
    return accounts.create_first_admin(NewAccountFactory.admin()).account


@pytest.fixture
def bob(accounts: AccountService, alice: Account) -> Account:
    return accounts.create_account(alice, NewAccountFactory.member())


@pytest.fixture
def enriching(
    units: sessionmaker[Session], clock: FakeClock, tmp_path: Path
) -> Iterator[Enriching]:
    with running_enrichment(units, clock, tmp_path / "data") as running:
        yield running


def _found(enriching: Enriching, who: Account, track_id: TrackId) -> JobView:
    """Find the Track's details, and wait for the Job to succeed."""
    job = enriching.enrichment.find_details(who, track_id, NAME)
    return enriching.wait_for(job.id, JobState.SUCCEEDED)


def _failed(enriching: Enriching, who: Account, track_id: TrackId) -> JobView:
    """Find the Track's details, and wait for the Job to fail."""
    job = enriching.enrichment.find_details(who, track_id, NAME)
    return enriching.wait_for(job.id, JobState.FAILED)


def _text_row(units: sessionmaker[Session], track_id: TrackId) -> VideoTextRow | None:
    with units() as db:
        return db.get(VideoTextRow, track_id)


def _video_values(enriching: Enriching, track_id: TrackId) -> dict[Field, str | int]:
    return enriching.details.details(track_id).values.get(Origin.VIDEO, {})


def test_a_site_tracks_video_text_is_read_by_the_one_parser_and_recorded_as_the_video_origin(
    enriching: Enriching, alice: Account, units: sessionmaker[Session], clock: FakeClock
) -> None:
    track_id = enriching.add_site_track(RECORDED)

    _found(enriching, alice, track_id)

    row = _text_row(units, track_id)
    assert row is not None
    assert (row.title, row.description, row.came_from, row.recorded_at) == (
        RECORDED_TITLE,
        "-",
        "site",
        clock(),
    )
    read = dict(read_video(VideoText(RECORDED_TITLE, "-")).values)
    assert {f: v for f, v in _video_values(enriching, track_id).items() if f != Field.COVER} == read


def test_edit_details_shows_the_text_read_from_the_site(
    enriching: Enriching, alice: Account
) -> None:
    track_id = enriching.add_site_track(RECORDED)

    _found(enriching, alice, track_id)

    view = enriching.details.details(track_id)
    assert view.video_text == VideoText(RECORDED_TITLE, "-")
    assert view.shown[Field.TITLE].origin is Origin.VIDEO


def test_the_cover_is_stored_once_and_recorded_as_the_video_origins_cover(
    enriching: Enriching, alice: Account
) -> None:
    track_id = enriching.add_site_track(RECORDED)

    _found(enriching, alice, track_id)

    name = cover_id(jpeg_image(RECORDED))
    assert _video_values(enriching, track_id)[Field.COVER] == name
    assert (enriching.data_dir / "covers" / name).read_bytes() == jpeg_image(RECORDED)
    assert enriching.covers.open(name) is not None


def test_the_cover_shows_on_the_track(enriching: Enriching, alice: Account) -> None:
    track_id = enriching.add_site_track(RECORDED)

    _found(enriching, alice, track_id)

    assert enriching.catalog.get_track(alice.id, track_id).details.cover == cover_id(
        jpeg_image(RECORDED)
    )


@pytest.mark.parametrize("video", ["BVNoCover", "BVNotAnImage", "BVEscape"])
def test_a_video_whose_cover_is_missing_or_no_image_still_has_its_text(
    enriching: Enriching, alice: Account, video: str
) -> None:
    track_id = enriching.add_site_track(video)

    _found(enriching, alice, track_id)

    assert Field.COVER not in _video_values(enriching, track_id)
    assert enriching.details.details(track_id).video_text is not None
    assert not (enriching.data_dir / "covers").exists()


def test_the_asked_enricher_is_given_the_video_of_a_library_file_named_for_one(
    enriching: Enriching, alice: Account
) -> None:
    track_id = enriching.add_file_track(f"{RECORDED}.m4a")

    _found(enriching, alice, track_id)

    assert enriching.details.details(track_id).video_text is not None


def test_a_cover_the_household_chose_stays_over_the_sites(
    enriching: Enriching, alice: Account
) -> None:
    track_id = enriching.add_file_track(f"{RECORDED}.m4a")
    own = enriching.covers.set_cover(track_id, jpeg_image("the household's"))

    _found(enriching, alice, track_id)

    assert enriching.catalog.get_track(alice.id, track_id).details.cover == own
    assert _video_values(enriching, track_id)[Field.COVER] == cover_id(jpeg_image(RECORDED))


def test_the_enricher_is_asked_through_the_proxy_set_for_the_site(
    enriching: Enriching, alice: Account
) -> None:
    enriching.proxies.save(alice, "bilibili", "socks5h://127.0.0.1:7890")
    track_id = enriching.add_site_track("BVProxyEcho")

    _found(enriching, alice, track_id)

    row = _text_row(enriching.units, track_id)
    assert row is not None
    assert row.title == "proxy=socks5h://127.0.0.1:7890"


def test_without_a_proxy_the_enricher_is_asked_directly(
    enriching: Enriching, alice: Account
) -> None:
    track_id = enriching.add_site_track("BVProxyEcho")

    _found(enriching, alice, track_id)

    row = _text_row(enriching.units, track_id)
    assert row is not None
    assert row.title == "proxy=none"


def test_values_an_enricher_answers_are_checked_and_recorded_under_its_origin(
    enriching: Enriching, alice: Account
) -> None:
    track_id = enriching.add_site_track("BVValues")

    _found(enriching, alice, track_id)

    values = _video_values(enriching, track_id)
    assert (values[Field.GENRE], values[Field.YEAR]) == ("Vocaloid", 2014)
    assert _text_row(enriching.units, track_id) is None


def test_values_that_break_the_rules_for_a_detail_fail_the_job_and_record_nothing(
    enriching: Enriching, alice: Account
) -> None:
    track_id = enriching.add_site_track("BVBadValues")

    failed = _failed(enriching, alice, track_id)

    assert failed.job.failure_kind == "program"
    assert Field.YEAR not in _video_values(enriching, track_id)


# Who is asked for


def test_a_track_with_a_bilibili_source_or_a_file_named_for_a_video_is_eligible(
    enriching: Enriching,
) -> None:
    site = enriching.add_site_track(RECORDED)
    file = enriching.add_file_track("BV1dm4y1s7ak.m4a")
    enriching.add_file_track("Night Drive.m4a")

    assert enriching.enrichment.eligible(NAME) == [site, file]


def test_a_song_inside_a_longer_file_is_not_eligible_but_its_album_file_is(
    enriching: Enriching, units: sessionmaker[Session], clock: FakeClock
) -> None:
    album = enriching.add_site_track("BV1dm4y1s7ak")
    songs = SongsService(units, clock).save(
        album, [SongRow(None, Song(0, "Intro")), SongRow(None, Song(60_000, "Outro"))]
    )

    eligible = enriching.enrichment.eligible(NAME)

    assert eligible == [album]
    assert all(song.track_id not in eligible for song in songs.songs)


def test_asking_for_a_song_inside_a_longer_file_is_refused(
    enriching: Enriching, alice: Account, units: sessionmaker[Session], clock: FakeClock
) -> None:
    album = enriching.add_site_track("BV1dm4y1s7ak")
    songs = SongsService(units, clock).save(
        album, [SongRow(None, Song(0, "Intro")), SongRow(None, Song(60_000, "Outro"))]
    )

    with pytest.raises(ConflictError, match="longer file"):
        enriching.enrichment.find_details(alice, songs.songs[0].track_id, NAME)


def test_a_track_without_a_video_is_refused(enriching: Enriching, alice: Account) -> None:
    track_id = enriching.add_file_track("Night Drive.m4a")

    with pytest.raises(ConflictError, match="no video"):
        enriching.enrichment.find_details(alice, track_id, NAME)


def test_a_track_whose_video_text_the_household_entered_is_not_eligible(
    enriching: Enriching, alice: Account
) -> None:
    track_id = enriching.add_site_track(RECORDED)

    enriching.details.read_video_text(track_id, VideoText("Melt / ryo", ""))

    assert enriching.enrichment.eligible(NAME) == []
    with pytest.raises(ConflictError, match="entered by the household"):
        enriching.enrichment.find_details(alice, track_id, NAME)


def test_a_track_whose_video_text_came_from_a_file_beside_it_is_not_eligible(
    enriching: Enriching, units: sessionmaker[Session], clock: FakeClock
) -> None:
    track_id = enriching.add_file_track(f"{RECORDED}.m4a")

    with units.begin() as db:
        record_video_text(db, track_id, VideoText("Melt / ryo"), "file", clock())

    assert enriching.enrichment.eligible(NAME) == []


def test_a_video_is_not_asked_again_for_a_day_and_is_after_it(
    enriching: Enriching, alice: Account
) -> None:
    track_id = enriching.add_site_track(RECORDED)
    _found(enriching, alice, track_id)

    enriching.clock.advance(ASK_AGAIN_AFTER - timedelta(seconds=1))
    just_before = enriching.enrichment.eligible(NAME)
    enriching.clock.advance(timedelta(seconds=1))
    after = enriching.enrichment.eligible(NAME)

    assert (just_before, after) == ([], [track_id])


def test_when_a_video_was_asked_is_kept_in_the_database_so_a_restart_forgets_nothing(
    enriching: Enriching, alice: Account, units: sessionmaker[Session], clock: FakeClock
) -> None:
    track_id = enriching.add_site_track(RECORDED)
    _found(enriching, alice, track_id)

    with units() as db:
        asked = db.execute(select(VideoAskRow.enricher, VideoAskRow.video, VideoAskRow.asked_at))
        assert [tuple(row) for row in asked] == [(NAME, RECORDED, clock())]


def test_another_part_of_a_video_just_asked_about_is_left_alone_for_a_day_too(
    enriching: Enriching, alice: Account
) -> None:
    first = enriching.add_site_track(RECORDED, part=1)
    second = enriching.add_site_track(RECORDED, part=2)
    _found(enriching, alice, first)

    with pytest.raises(ConflictError, match="24 hours"):
        enriching.enrichment.find_details(alice, second, NAME)


def test_a_sidecar_read_afterwards_replaces_the_sites_text_and_stops_enrichment(
    enriching: Enriching, alice: Account, units: sessionmaker[Session], clock: FakeClock
) -> None:
    track_id = enriching.add_file_track(f"{RECORDED}.m4a")
    _found(enriching, alice, track_id)
    clock.advance(ASK_AGAIN_AFTER)

    with units.begin() as db:
        record_video_text(db, track_id, VideoText("Melt / ryo"), "file", clock())

    row = _text_row(units, track_id)
    assert row is not None
    assert (row.title, row.came_from) == ("Melt / ryo", "file")
    assert Field.COVER not in _video_values(enriching, track_id)
    assert enriching.enrichment.eligible(NAME) == []


def test_text_the_household_enters_while_the_job_runs_is_not_replaced_by_the_sites(
    enriching: Enriching, alice: Account
) -> None:
    track_id = enriching.add_site_track("BVSlow")
    job = enriching.enrichment.find_details(alice, track_id, NAME)
    enriching.wait_for(job.id, JobState.RUNNING)

    enriching.details.read_video_text(track_id, VideoText("Melt / ryo", ""))
    done = enriching.wait_for(job.id, JobState.SUCCEEDED)

    row = _text_row(enriching.units, track_id)
    assert row is not None
    assert (row.title, row.came_from, done.job.state) == (
        "Melt / ryo",
        "household",
        JobState.SUCCEEDED,
    )


# How the Jobs run


def test_a_job_is_one_per_track_with_the_enrichers_name_in_its_request(
    enriching: Enriching, alice: Account, units: sessionmaker[Session]
) -> None:
    track_id = enriching.add_site_track(RECORDED)

    job = enriching.enrichment.find_details(alice, track_id, NAME)

    assert (job.kind, job.target, job.requested_by) == (
        ENRICH_KIND,
        enrich_target(track_id),
        alice.id,
    )
    again = enriching.enrichment.find_details(alice, track_id, NAME)
    assert again.id == job.id


def test_the_jobs_of_one_enricher_run_one_at_a_time_with_a_pause_between_them(
    enriching: Enriching, alice: Account
) -> None:
    first = enriching.add_site_track("BVSlow")
    second = enriching.add_site_track(RECORDED)
    job_1 = enriching.enrichment.find_details(alice, first, NAME)
    job_2 = enriching.enrichment.find_details(alice, second, NAME)

    enriching.wait_for(job_1.id, JobState.RUNNING)
    while_first_runs = enriching.jobs.get_job(job_2.id).job.state
    enriching.wait_for(job_1.id, JobState.SUCCEEDED)
    time.sleep(SETTLE)
    during_the_pause = enriching.jobs.get_job(job_2.id).job.state
    enriching.clock.advance(PAUSE - timedelta(seconds=1))
    enriching.runner.wake()
    time.sleep(SETTLE)
    just_before_it_ends = enriching.jobs.get_job(job_2.id).job.state
    enriching.pause_passes()
    enriching.wait_for(job_2.id, JobState.SUCCEEDED)

    assert (while_first_runs, during_the_pause, just_before_it_ends) == (
        JobState.QUEUED,
        JobState.QUEUED,
        JobState.QUEUED,
    )


def test_offline_the_job_waits_and_asks_the_site_once_online(
    enriching: Enriching, alice: Account
) -> None:
    enriching.online.online = False
    track_id = enriching.add_site_track(RECORDED)

    job = enriching.enrichment.find_details(alice, track_id, NAME)
    time.sleep(SETTLE)
    held = enriching.jobs.get_job(job.id)
    enriching.online.online = True
    enriching.runner.follow_mode()
    enriching.wait_for(job.id, JobState.SUCCEEDED)

    assert (held.job.state, held.waits_for_online) == (JobState.QUEUED, True)


def test_a_network_failure_waits_to_try_again_and_does_not_count_as_asking(
    enriching: Enriching, alice: Account
) -> None:
    track_id = enriching.add_site_track("BVDown")

    job = enriching.enrichment.find_details(alice, track_id, NAME)
    waiting = enriching.wait_for(job.id, JobState.WAITING)

    assert waiting.job.failure_kind == "network"
    assert enriching.enrichment.eligible(NAME) == [track_id]


def test_a_fault_in_the_plugin_fails_that_job_alone_and_asks_again_later(
    enriching: Enriching, alice: Account
) -> None:
    track_id = enriching.add_site_track("BVBroken")
    job = enriching.enrichment.find_details(alice, track_id, NAME)

    queued = enriching.wait_for(
        job.id, JobState.QUEUED, until=lambda view: view.job.failure_kind is not None
    )

    assert queued.job.failure_kind == "plugin"
    assert enriching.enrichment.state(NAME).stopped_at is None
    assert enriching.enrichment.eligible(NAME) == [track_id]


# What the site answers


def test_a_video_that_is_gone_fails_that_tracks_job_only_and_the_next_still_runs(
    enriching: Enriching, alice: Account
) -> None:
    gone = enriching.add_site_track("BVGone")
    other = enriching.add_site_track(RECORDED)
    gone_job = enriching.enrichment.find_details(alice, gone, NAME)
    other_job = enriching.enrichment.find_details(alice, other, NAME)

    failed = enriching.wait_for(gone_job.id, JobState.FAILED)
    enriching.pause_passes()
    enriching.wait_for(other_job.id, JobState.SUCCEEDED)

    assert (failed.job.failure_kind, failed.job.failure_message) == (
        "gone",
        "The video was removed.",
    )
    assert enriching.enrichment.state(NAME).stopped_at is None


def test_a_video_that_is_gone_counts_as_asked_so_it_is_left_alone_for_a_day(
    enriching: Enriching, alice: Account
) -> None:
    gone = enriching.add_site_track("BVGone")
    _failed(enriching, alice, gone)

    assert enriching.enrichment.eligible(NAME) == []
    with pytest.raises(ConflictError, match="24 hours"):
        enriching.enrichment.find_details(alice, gone, NAME)


def test_the_first_refusal_stops_the_enricher_and_fails_its_queued_jobs_with_a_clear_message(
    enriching: Enriching, alice: Account
) -> None:
    refused = enriching.add_site_track("BVRefused")
    behind = [enriching.add_site_track("BVNoCover"), enriching.add_site_track(RECORDED)]
    jobs = [enriching.enrichment.find_details(alice, track, NAME) for track in [refused, *behind]]

    first = enriching.wait_for(jobs[0].id, JobState.FAILED)
    queued = [enriching.wait_for(job.id, JobState.FAILED) for job in jobs[1:]]

    assert (first.job.failure_kind, first.job.failure_message) == ("refused", "HTTP Error 412.")
    assert [view.job.failure_kind for view in queued] == ["refused", "refused"]
    for view in queued:
        assert (
            "stopped after the site refused a request: HTTP Error 412" in view.job.failure_message
        )
        assert "An admin can reset it" in view.job.failure_message
    assert all(view.job.started_at is None for view in queued)


def test_a_stopped_enricher_asks_nothing_more_and_says_why(
    enriching: Enriching, alice: Account, clock: FakeClock
) -> None:
    refused = enriching.add_site_track("BVRefused")
    other = enriching.add_site_track(RECORDED)
    _failed(enriching, alice, refused)

    state = enriching.enrichment.state(NAME)

    assert (state.available, state.stopped_at, state.reason) == (True, clock(), "HTTP Error 412.")
    assert enriching.enrichment.eligible(NAME) == []
    with pytest.raises(ConflictError, match="stopped"):
        enriching.enrichment.find_details(alice, other, NAME)
    with pytest.raises(ConflictError, match="stopped"):
        enriching.enrichment.find_details_for_all(alice, NAME)


def test_a_job_retried_while_the_enricher_is_stopped_fails_without_asking_the_site(
    enriching: Enriching, alice: Account
) -> None:
    refused = enriching.add_site_track("BVRefused")
    first = _failed(enriching, alice, refused)
    enriching.pause_passes()

    retried = enriching.jobs.retry(alice, first.job.id)
    again = enriching.wait_for(retried.id, JobState.FAILED)

    assert again.job.failure_kind == "refused"
    assert "stopped" in again.job.failure_message
    assert again.job.attempts == 0


def test_the_stopped_state_survives_a_restart(
    enriching: Enriching, alice: Account, units: sessionmaker[Session]
) -> None:
    refused = enriching.add_site_track("BVRefused")
    _failed(enriching, alice, refused)

    with units() as db:
        stop = db.get_one(EnricherStopRow, NAME)

    assert stop.reason == "HTTP Error 412."


def test_an_admin_resets_a_stopped_enricher_and_it_is_asked_again(
    enriching: Enriching, alice: Account
) -> None:
    refused = enriching.add_site_track("BVRefused")
    other = enriching.add_site_track(RECORDED)
    _failed(enriching, alice, refused)

    enriching.enrichment.reset(alice, NAME)

    assert enriching.enrichment.state(NAME).stopped_at is None
    assert enriching.enrichment.eligible(NAME) == [other]
    enriching.pause_passes()
    _found(enriching, alice, other)


def test_a_member_cannot_reset_an_enricher(enriching: Enriching, bob: Account) -> None:
    with pytest.raises(ForbiddenError):
        enriching.enrichment.reset(bob, NAME)


def test_resetting_an_enricher_that_is_not_stopped_changes_nothing(
    enriching: Enriching, alice: Account
) -> None:
    enriching.enrichment.reset(alice, NAME)
    enriching.enrichment.reset(alice, NAME)

    assert enriching.enrichment.state(NAME).stopped_at is None


# Who may ask


def test_any_signed_in_account_finds_details_for_one_track(
    enriching: Enriching, bob: Account
) -> None:
    track_id = enriching.add_site_track(RECORDED)

    done = _found(enriching, bob, track_id)

    assert done.job.requested_by == bob.id


def test_an_admin_queues_every_eligible_track_and_is_told_how_many(
    enriching: Enriching, alice: Account
) -> None:
    for video in ["BVNoCover", RECORDED]:
        enriching.add_site_track(video)
    enriching.add_file_track("Night Drive.m4a")

    queued = enriching.enrichment.find_details_for_all(alice, NAME)

    assert queued == 2


def test_queueing_every_track_again_counts_only_the_tracks_not_already_queued(
    enriching: Enriching, alice: Account
) -> None:
    enriching.add_site_track("BVNoCover")
    enriching.enrichment.find_details_for_all(alice, NAME)
    enriching.add_site_track(RECORDED)

    queued = enriching.enrichment.find_details_for_all(alice, NAME)

    assert queued == 1


def test_a_member_cannot_queue_every_track(enriching: Enriching, bob: Account) -> None:
    enriching.add_site_track(RECORDED)

    with pytest.raises(ForbiddenError):
        enriching.enrichment.find_details_for_all(bob, NAME)

    assert enriching.jobs.list_jobs() == []


def test_the_jobs_of_a_bulk_queue_all_run_one_after_another(
    enriching: Enriching, alice: Account
) -> None:
    for video in ["BVNoCover", RECORDED, "BVValues"]:
        enriching.add_site_track(video)

    enriching.enrichment.find_details_for_all(alice, NAME)
    enriching.finish_every_job()

    assert {view.job.state for view in enriching.jobs.list_jobs()} == {JobState.SUCCEEDED}
    assert enriching.enrichment.eligible(NAME) == []


def test_an_enricher_that_is_not_known_is_refused(enriching: Enriching, alice: Account) -> None:
    track_id = enriching.add_site_track(RECORDED)

    with pytest.raises(InvalidInputError):
        enriching.enrichment.find_details(alice, track_id, "musicbrainz")


def test_a_track_that_does_not_exist_is_not_found(enriching: Enriching, alice: Account) -> None:
    with pytest.raises(NotFoundError):
        enriching.enrichment.find_details(alice, TrackId(999), NAME)


def test_an_enricher_whose_plugin_is_off_cannot_be_asked(
    units: sessionmaker[Session],
    clock: FakeClock,
    plugins: PluginService,
    jobs: JobService,
    alice: Account,
) -> None:
    kind = enrich_track_kind(Path("covers"), clock)
    service = EnrichmentService(units, clock, plugins, jobs, kind)

    assert service.state(NAME).available is False
    with pytest.raises(PluginUnavailableError, match="turned off"):
        service.find_details(alice, TrackId(1), NAME)
