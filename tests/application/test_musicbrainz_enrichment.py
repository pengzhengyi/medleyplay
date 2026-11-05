"""Finding a Track on MusicBrainz in real Jobs, through the test plugin `reader`."""

import time
from collections.abc import Iterator
from datetime import timedelta
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.accounts import AccountService
from medleyplay.application.enrichment import ENRICH_KIND, enrich_target
from medleyplay.application.segments import SongsService
from medleyplay.domain.accounts import Account
from medleyplay.domain.catalog import SourceKey, TrackDetails, TrackId
from medleyplay.domain.covers import cover_id
from medleyplay.domain.details import Field, Origin
from medleyplay.domain.enrichers import (
    ASK_AGAIN_AFTER,
    BILIBILI_DETAILS,
    MUSICBRAINZ,
    SearchTerms,
)
from medleyplay.domain.errors import ConflictError, ForbiddenError
from medleyplay.domain.jobs import JobState, JobView
from medleyplay.domain.segments import SongRow
from medleyplay.domain.video_text import Song, VideoText
from medleyplay.persistence.schema import EnricherAskRow
from tests.support.enrichment import SETTLE, Enriching, running_enrichment
from tests.support.factories import NewAccountFactory
from tests.support.fakes import FakeClock
from tests.support.images import jpeg_image

NAME = MUSICBRAINZ.name


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
    """Find the Track on MusicBrainz, and wait for the Job to succeed."""
    job = enriching.enrichment.find_details(who, track_id, NAME)
    return enriching.wait_for(job.id, JobState.SUCCEEDED)


def _failed(enriching: Enriching, who: Account, track_id: TrackId) -> JobView:
    """Find the Track on MusicBrainz, and wait for the Job to fail."""
    job = enriching.enrichment.find_details(who, track_id, NAME)
    return enriching.wait_for(job.id, JobState.FAILED)


def _musicbrainz_values(enriching: Enriching, track_id: TrackId) -> dict[Field, str | int]:
    return enriching.details.details(track_id).values.get(Origin.MUSICBRAINZ, {})


def _album_file(enriching: Enriching, album: str) -> TrackId:
    """Add a long file of the album `album` by 朴树 and split it into two songs."""
    track_id = enriching.add_song(album, artist="", album=album, origin=Origin.VIDEO)
    enriching.details.put_household(track_id, {"album_artist": "朴树"})
    SongsService(enriching.units, enriching.clock).save(
        track_id, [SongRow(None, Song(0, "Intro")), SongRow(None, Song(60_000, "Outro"))]
    )
    return track_id


# What is recorded


def test_a_song_is_recorded_under_the_musicbrainz_origin_with_every_value_it_gives(
    enriching: Enriching, alice: Account
) -> None:
    track_id = enriching.add_song("Let Down")

    _found(enriching, alice, track_id)

    assert _musicbrainz_values(enriching, track_id) == {
        Field.TITLE: "Let Down",
        Field.ARTIST: "Radiohead",
        Field.ALBUM: "OK Computer",
        Field.ALBUM_ARTIST: "Radiohead",
        Field.YEAR: 1997,
        Field.TRACK_NUMBER: 5,
        Field.DISC_NUMBER: 1,
        Field.COVER: cover_id(jpeg_image("Let Down")),
    }


def test_the_cover_is_stored_once_and_shows_on_the_track(
    enriching: Enriching, alice: Account
) -> None:
    track_id = enriching.add_song("Let Down")

    _found(enriching, alice, track_id)

    name = cover_id(jpeg_image("Let Down"))
    assert (enriching.data_dir / "covers" / name).read_bytes() == jpeg_image("Let Down")
    assert enriching.catalog.get_track(alice.id, track_id).details.cover == name


def test_a_found_album_shows_where_the_file_names_none(
    enriching: Enriching, alice: Account
) -> None:
    track_id = enriching.add_song("Let Down")

    _found(enriching, alice, track_id)

    shown = enriching.details.details(track_id).shown
    assert (shown[Field.ALBUM].value, shown[Field.ALBUM].origin) == (
        "OK Computer",
        Origin.MUSICBRAINZ,
    )
    assert shown[Field.TITLE].origin is Origin.FILES


def test_a_found_title_replaces_the_one_the_video_gave(
    enriching: Enriching, alice: Account
) -> None:
    track_id = enriching.add_song("Remaster", origin=Origin.VIDEO)

    _found(enriching, alice, track_id)

    shown = enriching.details.details(track_id).shown[Field.TITLE]
    assert (shown.value, shown.origin) == ("Remaster (2016)", Origin.MUSICBRAINZ)


def test_the_households_own_album_stays_over_the_found_one(
    enriching: Enriching, alice: Account
) -> None:
    track_id = enriching.add_song("Let Down")
    enriching.details.put_household(track_id, {"album": "My Mix"})

    _found(enriching, alice, track_id)

    assert enriching.details.details(track_id).shown[Field.ALBUM].value == "My Mix"


def test_a_cover_missing_from_the_answer_leaves_the_values_without_one(
    enriching: Enriching, alice: Account
) -> None:
    track_id = enriching.add_song("NoCover")

    _found(enriching, alice, track_id)

    assert Field.COVER not in _musicbrainz_values(enriching, track_id)
    assert _musicbrainz_values(enriching, track_id)[Field.ALBUM] == "OK Computer"


def test_an_answer_with_no_values_succeeds_records_nothing_and_counts_as_asked(
    enriching: Enriching, alice: Account
) -> None:
    track_id = enriching.add_song("Nowhere")

    _found(enriching, alice, track_id)

    assert _musicbrainz_values(enriching, track_id) == {}
    assert enriching.enrichment.eligible(NAME) == []


def test_values_that_break_the_rules_for_a_detail_fail_the_job_and_record_nothing(
    enriching: Enriching, alice: Account
) -> None:
    track_id = enriching.add_song("BadValues")

    failed = _failed(enriching, alice, track_id)

    assert failed.job.failure_kind == "program"
    assert _musicbrainz_values(enriching, track_id) == {}


def test_a_long_file_split_into_songs_gets_its_album_year_and_cover(
    enriching: Enriching, alice: Account
) -> None:
    track_id = _album_file(enriching, "生如夏花")

    _found(enriching, alice, track_id)

    assert _musicbrainz_values(enriching, track_id) == {
        Field.ALBUM: "生如夏花",
        Field.ALBUM_ARTIST: "朴树",
        Field.YEAR: 2003,
        Field.COVER: cover_id(jpeg_image("生如夏花")),
    }


# What is asked


def test_the_ask_carries_what_the_track_shows_its_length_and_file_and_nothing_of_a_video(
    enriching: Enriching, alice: Account
) -> None:
    track_id = enriching.add_song("Echo")

    _found(enriching, alice, track_id)

    assert _musicbrainz_values(enriching, track_id)[Field.ALBUM] == (
        "whole_album=False video=None proxy=none duration=299000 file=Echo.m4a"
        " shown=['artist', 'title']"
    )


def test_the_ask_leaves_out_what_musicbrainz_itself_said_before(
    enriching: Enriching, alice: Account
) -> None:
    track_id = enriching.add_song("Echo")
    _found(enriching, alice, track_id)
    enriching.clock.advance(ASK_AGAIN_AFTER)
    enriching.details.put_household(track_id, {"genre": "Rock"})

    _found(enriching, alice, track_id)

    assert "shown=['artist', 'genre', 'title']" in str(
        _musicbrainz_values(enriching, track_id)[Field.ALBUM]
    )


def test_a_long_file_is_asked_about_as_a_whole_album(enriching: Enriching, alice: Account) -> None:
    track_id = _album_file(enriching, "Echo")

    _found(enriching, alice, track_id)

    assert str(_musicbrainz_values(enriching, track_id)[Field.ALBUM]).startswith("whole_album=True")


def test_musicbrainz_is_asked_directly_even_when_a_proxy_is_set_for_bilibili(
    enriching: Enriching, alice: Account
) -> None:
    enriching.proxies.save(alice, "bilibili", "socks5h://127.0.0.1:7890")
    track_id = enriching.add_song("Echo")

    _found(enriching, alice, track_id)

    assert " proxy=none " in str(_musicbrainz_values(enriching, track_id)[Field.ALBUM])


# Who is asked for


def test_a_song_whose_file_says_its_title_and_artist_is_eligible(enriching: Enriching) -> None:
    track_id = enriching.add_song("Let Down")

    assert enriching.enrichment.eligible(NAME) == [track_id]


def test_a_song_the_video_titled_and_credited_is_eligible_with_no_file_name_to_go_by(
    enriching: Enriching,
) -> None:
    track_id = enriching.add_site_track("BV1AC4y1L7Yi")
    enriching.details.put_household(track_id, {"artist": "Radiohead"})

    assert enriching.enrichment.eligible(NAME) == [track_id]


def test_a_file_that_only_its_name_titles_is_not_eligible(
    enriching: Enriching, alice: Account
) -> None:
    track_id = enriching.add_file_track("Night Drive.m4a")

    assert enriching.enrichment.eligible(NAME) == []
    with pytest.raises(ConflictError, match="title and artist"):
        enriching.enrichment.find_details(alice, track_id, NAME)


def test_a_song_with_a_title_but_no_artist_is_not_eligible(enriching: Enriching) -> None:
    enriching.add_song("Let Down", artist="")

    assert enriching.enrichment.eligible(NAME) == []


def test_a_song_inside_a_longer_file_is_not_eligible_but_its_album_file_is(
    enriching: Enriching, alice: Account
) -> None:
    album = _album_file(enriching, "生如夏花")
    songs = SongsService(enriching.units, enriching.clock).songs(album).songs

    eligible = enriching.enrichment.eligible(NAME)

    assert eligible == [album]
    with pytest.raises(ConflictError, match="longer file"):
        enriching.enrichment.find_details(alice, songs[0].track_id, NAME)


def test_a_long_file_with_only_a_title_and_an_artist_is_not_eligible(
    enriching: Enriching,
) -> None:
    track_id = enriching.add_song("Mixtape")
    SongsService(enriching.units, enriching.clock).save(
        track_id, [SongRow(None, Song(0, "Intro")), SongRow(None, Song(60_000, "Outro"))]
    )

    assert enriching.enrichment.eligible(NAME) == []


def test_a_track_whose_video_text_the_household_entered_is_still_eligible(
    enriching: Enriching,
) -> None:
    track_id = enriching.add_song("Let Down")
    enriching.details.read_video_text(track_id, VideoText("Let Down / Radiohead", ""))

    assert enriching.enrichment.eligible(NAME) == [track_id]


def test_what_each_enricher_may_be_asked_about_is_its_own(enriching: Enriching) -> None:
    song = enriching.add_song("Let Down")
    video = enriching.add_site_track("BV1AC4y1L7Yi")

    assert enriching.enrichment.eligible(BILIBILI_DETAILS.name) == [video]
    assert song not in enriching.enrichment.eligible(BILIBILI_DETAILS.name)


# Once a day


def test_a_track_just_found_is_not_asked_for_again_for_a_day(
    enriching: Enriching, alice: Account
) -> None:
    track_id = enriching.add_song("Let Down")
    _found(enriching, alice, track_id)

    enriching.clock.advance(ASK_AGAIN_AFTER - timedelta(seconds=1))
    just_before = enriching.enrichment.eligible(NAME)
    enriching.clock.advance(timedelta(seconds=1))
    after = enriching.enrichment.eligible(NAME)

    assert (just_before, after) == ([], [track_id])


def test_asking_again_within_a_day_is_refused(enriching: Enriching, alice: Account) -> None:
    track_id = enriching.add_song("Let Down")
    _found(enriching, alice, track_id)

    with pytest.raises(ConflictError, match="24 hours"):
        enriching.enrichment.find_details(alice, track_id, NAME)


def test_two_tracks_with_the_same_words_are_each_asked_for(
    enriching: Enriching, alice: Account
) -> None:
    first = enriching.add_song("Let Down")
    second = enriching.catalog.add_track(
        SourceKey("library", "2/Music/Let Down.flac"), TrackDetails("Let Down", "Radiohead")
    )
    _found(enriching, alice, first)

    assert enriching.enrichment.eligible(NAME) == [second]


def test_a_title_the_household_corrects_is_asked_for_at_once(
    enriching: Enriching, alice: Account
) -> None:
    track_id = enriching.add_song("Let Down")
    _found(enriching, alice, track_id)

    enriching.details.put_household(track_id, {"title": "Let Down (Live)"})

    assert enriching.enrichment.eligible(NAME) == [track_id]


def test_what_musicbrainz_said_does_not_make_a_track_new_to_ask_for(
    enriching: Enriching, alice: Account
) -> None:
    track_id = enriching.add_song("Remaster", origin=Origin.VIDEO)

    _found(enriching, alice, track_id)

    assert enriching.details.details(track_id).shown[Field.TITLE].value == "Remaster (2016)"
    assert enriching.enrichment.eligible(NAME) == []


def test_when_a_track_was_asked_is_kept_in_the_database_under_a_key_not_its_words(
    enriching: Enriching, alice: Account, units: sessionmaker[Session], clock: FakeClock
) -> None:
    track_id = enriching.add_song("Let Down")
    _found(enriching, alice, track_id)

    with units() as db:
        asked = db.execute(
            select(EnricherAskRow.enricher, EnricherAskRow.subject, EnricherAskRow.asked_at)
        ).all()
    terms = SearchTerms("Let Down", "Radiohead", None, None, whole_album=False)
    assert [tuple(row) for row in asked] == [(NAME, terms.key(track_id), clock())]


def test_the_asks_of_bilibili_and_of_musicbrainz_are_kept_apart(
    enriching: Enriching, alice: Account
) -> None:
    site = enriching.add_site_track("BV1AC4y1L7Yi")
    enriching.details.put_household(site, {"title": "Let Down", "artist": "Radiohead"})
    job = enriching.enrichment.find_details(alice, site, BILIBILI_DETAILS.name)
    enriching.wait_for(job.id, JobState.SUCCEEDED)

    assert enriching.enrichment.eligible(NAME) == [site]


# How the Jobs run


def test_a_job_is_one_per_track_and_asking_again_returns_the_one_active(
    enriching: Enriching, alice: Account
) -> None:
    track_id = enriching.add_song("Let Down")

    job = enriching.enrichment.find_details(alice, track_id, NAME)
    again = enriching.enrichment.find_details(alice, track_id, NAME)

    assert (job.kind, job.target) == (ENRICH_KIND, enrich_target(track_id, NAME))
    assert again.id == job.id


def test_the_jobs_of_musicbrainz_run_one_at_a_time_a_second_apart(
    enriching: Enriching, alice: Account
) -> None:
    first = enriching.add_song("Let Down")
    second = enriching.add_song("Karma Police")
    job_1 = enriching.enrichment.find_details(alice, first, NAME)
    job_2 = enriching.enrichment.find_details(alice, second, NAME)

    enriching.wait_for(job_1.id, JobState.SUCCEEDED)
    time.sleep(SETTLE)
    during_the_pause = enriching.jobs.get_job(job_2.id).job.state
    enriching.clock.advance(MUSICBRAINZ.spacing - timedelta(milliseconds=500))
    enriching.runner.wake()
    time.sleep(SETTLE)
    just_before_it_ends = enriching.jobs.get_job(job_2.id).job.state
    enriching.clock.advance(timedelta(milliseconds=500))
    enriching.runner.wake()
    enriching.wait_for(job_2.id, JobState.SUCCEEDED)

    assert (during_the_pause, just_before_it_ends) == (JobState.QUEUED, JobState.QUEUED)


def test_offline_the_job_waits_and_asks_once_online(enriching: Enriching, alice: Account) -> None:
    enriching.online.online = False
    track_id = enriching.add_song("Let Down")

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
    track_id = enriching.add_song("Down")

    job = enriching.enrichment.find_details(alice, track_id, NAME)
    waiting = enriching.wait_for(job.id, JobState.WAITING)

    assert waiting.job.failure_kind == "network"
    assert enriching.enrichment.eligible(NAME) == [track_id]


def test_a_fault_in_the_plugin_fails_that_job_alone_and_asks_again_later(
    enriching: Enriching, alice: Account
) -> None:
    track_id = enriching.add_song("Broken")
    job = enriching.enrichment.find_details(alice, track_id, NAME)

    queued = enriching.wait_for(
        job.id, JobState.QUEUED, until=lambda view: view.job.failure_kind is not None
    )

    assert queued.job.failure_kind == "plugin"
    assert enriching.enrichment.state(NAME).stopped_at is None
    assert enriching.enrichment.eligible(NAME) == [track_id]


# A refusal


def test_a_refusal_fails_the_job_as_refused_and_stops_musicbrainz_until_an_admin_resets_it(
    enriching: Enriching, alice: Account
) -> None:
    refused = enriching.add_song("Refused")
    other = enriching.add_song("Let Down")

    failed = _failed(enriching, alice, refused)

    assert (failed.job.failure_kind, failed.job.failure_message) == ("refused", "HTTP Error 403.")
    assert enriching.enrichment.state(NAME).stopped_at is not None
    assert enriching.enrichment.eligible(NAME) == []
    with pytest.raises(ConflictError, match="stopped"):
        enriching.enrichment.find_details(alice, other, NAME)

    enriching.enrichment.reset(alice, NAME)

    assert enriching.enrichment.eligible(NAME) == [refused, other]


def test_a_refusal_fails_the_musicbrainz_jobs_that_have_not_started(
    enriching: Enriching, alice: Account
) -> None:
    refused = enriching.add_song("Refused")
    queued = enriching.add_song("Let Down")
    job_1 = enriching.enrichment.find_details(alice, refused, NAME)
    job_2 = enriching.enrichment.find_details(alice, queued, NAME)

    enriching.wait_for(job_1.id, JobState.FAILED)
    second = enriching.wait_for(job_2.id, JobState.FAILED)

    assert second.job.failure_kind == "refused"
    assert "stopped" in second.job.failure_message


def test_a_refused_track_is_asked_for_again_once_musicbrainz_is_reset(
    enriching: Enriching, alice: Account
) -> None:
    refused = enriching.add_song("Refused")
    _failed(enriching, alice, refused)
    enriching.enrichment.reset(alice, NAME)

    assert enriching.enrichment.eligible(NAME) == [refused]


def test_musicbrainz_refusing_does_not_stop_the_bilibili_enricher(
    enriching: Enriching, alice: Account
) -> None:
    refused = enriching.add_song("Refused")
    video = enriching.add_site_track("BV1AC4y1L7Yi")
    _failed(enriching, alice, refused)

    assert enriching.enrichment.state(BILIBILI_DETAILS.name).stopped_at is None
    assert enriching.enrichment.eligible(BILIBILI_DETAILS.name) == [video]


# Who may ask


def test_any_signed_in_account_finds_a_track_on_musicbrainz(
    enriching: Enriching, bob: Account
) -> None:
    track_id = enriching.add_song("Let Down")

    done = _found(enriching, bob, track_id)

    assert done.job.requested_by == bob.id


def test_an_admin_queues_every_eligible_track_and_is_told_how_many(
    enriching: Enriching, alice: Account
) -> None:
    enriching.add_song("Let Down")
    enriching.add_song("Karma Police")
    enriching.add_file_track("Night Drive.m4a")

    queued = enriching.enrichment.find_details_for_all(alice, NAME)

    assert queued == 2


def test_the_jobs_of_a_bulk_queue_all_run_one_after_another(
    enriching: Enriching, alice: Account
) -> None:
    for title in ["Let Down", "Karma Police", "Airbag"]:
        enriching.add_song(title)

    enriching.enrichment.find_details_for_all(alice, NAME)
    enriching.finish_every_job()

    assert {view.job.state for view in enriching.jobs.list_jobs()} == {JobState.SUCCEEDED}
    assert enriching.enrichment.eligible(NAME) == []


def test_a_member_cannot_queue_every_track_or_reset_musicbrainz(
    enriching: Enriching, bob: Account
) -> None:
    enriching.add_song("Let Down")

    with pytest.raises(ForbiddenError):
        enriching.enrichment.find_details_for_all(bob, NAME)
    with pytest.raises(ForbiddenError):
        enriching.enrichment.reset(bob, NAME)

    assert enriching.jobs.list_jobs() == []
