"""Auto-Match Jobs save each eligible song without a browser."""

from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.accounts import AccountService
from medleyplay.application.enrichment import ENRICH_KIND, enrich_target
from medleyplay.application.jobs import JobKind
from medleyplay.application.lyrics_match import MatchSongInput
from medleyplay.application.lyrics_match_state import MATCH_CHOOSE, MATCH_FIND, match_target
from medleyplay.application.lyrics_search import CHOOSE_LYRICS_KIND, choose_lyrics_target
from medleyplay.application.plugins import PluginService
from medleyplay.application.segments import SongsService
from medleyplay.application.settings import SettingsService
from medleyplay.domain.accounts import Account, AccountId
from medleyplay.domain.catalog import TrackId
from medleyplay.domain.enrichers import LYRICS
from medleyplay.domain.errors import (
    ConflictError,
    ForbiddenError,
    InvalidInputError,
    MedleyplayError,
)
from medleyplay.domain.jobs import Job, JobId, JobState
from medleyplay.domain.lyrics import LyricsSite
from medleyplay.domain.segments import SongRow
from medleyplay.domain.settings import Settings
from medleyplay.domain.video_text import Song
from medleyplay.plugin_api import LYRICS_CHOOSER, LYRICS_FINDER
from medleyplay.programs.enrich_track import EnrichedTrack, EnrichJob
from tests.support.ai import DEEPSEEK
from tests.support.enrichment import Enriching, running_enrichment
from tests.support.factories import NewAccountFactory
from tests.support.fakes import FakeClock
from tests.support.plugins.reader import lyrics_of


@pytest.fixture
def alice(accounts: AccountService) -> Account:
    return accounts.create_first_admin(NewAccountFactory.admin()).account


@pytest.fixture
def enriching(
    units: sessionmaker[Session], clock: FakeClock, tmp_path: Path
) -> Iterator[Enriching]:
    with running_enrichment(units, clock, tmp_path / "data") as running:
        yield running


def _album(
    enriching: Enriching, alice: Account, songs: SongsService
) -> tuple[TrackId, tuple[MatchSongInput, ...]]:
    enriching.ai.add(alice, DEEPSEEK, "deepseek-flash", None)
    album = enriching.add_song("Album")
    saved = songs.save(
        album,
        [
            SongRow(None, Song(0, "Melt", "ryo")),
            SongRow(None, Song(260_000, "Nowhere")),
            SongRow(None, Song(280_000, "Refused")),
        ],
    )
    return album, tuple(
        MatchSongInput(
            track_id=row.track_id,
            segment_id=row.id,
            start_ms=row.start_ms,
            title=row.title,
            artist=row.artist,
        )
        for row in saved.songs
    )


def test_auto_match_saves_a_pick_and_keeps_misses_and_failures_separate(
    enriching: Enriching, alice: Account, songs: SongsService
) -> None:
    album, rows = _album(enriching, alice, songs)

    started, *_rest = enriching.lyrics_match.start(alice, album, rows)
    enriching.finish_every_job()

    saved, missed, failed = enriching.lyrics_match.status(alice, album)
    assert [saved.state, missed.state, failed.state] == ["saved", "skipped", "failed"]
    kept = enriching.lyrics.lyrics(saved.track_id)
    assert kept is not None
    assert (kept.origin.value, kept.text) == ("lrclib", lyrics_of("Melt"))
    assert enriching.lyrics.lyrics(missed.track_id) is None
    assert enriching.lyrics.lyrics(failed.track_id) is None

    (again,) = enriching.lyrics_match.start(alice, album, [rows[0]])
    assert (again.state, again.job_id, again.previous_job_id) == ("skipped", None, started.job_id)


def test_submission_normalizes_repeated_rows_and_reuses_the_active_match(
    enriching: Enriching, alice: Account, accounts: AccountService, songs: SongsService
) -> None:
    album, (melt, *_rest) = _album(enriching, alice, songs)
    bob = accounts.create_account(alice, NewAccountFactory.member())
    other = enriching.add_song("Other")
    search = enriching.lyrics_search.find(alice, other, "Other", "Radiohead")
    enriching.wait_for(search, JobState.SUCCEEDED)

    (first,) = enriching.lyrics_match.start(alice, album, [melt, melt])
    (second,) = enriching.lyrics_match.start(bob, album, [melt])

    assert first.job_id is not None
    assert second.job_id == first.job_id
    assert enriching.jobs.get_job(first.job_id).job.requested_by == alice.id
    with pytest.raises(ForbiddenError):
        enriching.jobs.cancel(bob, first.job_id)


def test_saving_then_removing_lyrics_while_auto_match_waits_does_not_restore_them(
    enriching: Enriching, alice: Account, songs: SongsService
) -> None:
    album, (melt, *_rest) = _album(enriching, alice, songs)
    track_id, _ = _waiting_to_choose(enriching, alice, album, melt)

    enriching.lyrics.set_own(track_id, "Our corrections")
    enriching.lyrics.forget_own(track_id)
    enriching.finish_every_job()

    (reopened,) = enriching.lyrics_match.status(alice, album)
    assert reopened.state == "skipped"
    assert enriching.lyrics.lyrics(track_id) is None


def _waiting_to_choose(
    enriching: Enriching, alice: Account, album: TrackId, song: MatchSongInput
) -> tuple[TrackId, JobId]:
    """Keep the AI lane closed after an unrelated pick, so the match is between stages."""
    other = enriching.add_song("Other")
    search = enriching.lyrics_search.find(alice, other, "Other", "Radiohead")
    enriching.wait_for(search, JobState.SUCCEEDED)
    enriching.lyrics_search.choose(alice, other)
    chosen = enriching.jobs.latest(CHOOSE_LYRICS_KIND, choose_lyrics_target(other))
    assert chosen is not None
    enriching.wait_for(chosen.id, JobState.SUCCEEDED)
    enriching.clock.advance(LYRICS.spacing)
    (match,) = enriching.lyrics_match.start(alice, album, [song])
    assert match.job_id is not None
    enriching.wait_for(match.job_id, JobState.SUCCEEDED)
    assert enriching.jobs.active(MATCH_CHOOSE, match_target(match.track_id)) is not None
    return match.track_id, match.job_id


def test_changed_album_details_make_a_pending_pick_ineligible(
    enriching: Enriching, alice: Account, songs: SongsService
) -> None:
    album, (melt, *_rest) = _album(enriching, alice, songs)
    track_id, _ = _waiting_to_choose(enriching, alice, album, melt)

    enriching.details.put_household(track_id, {"album": "Another recording"})
    enriching.finish_every_job()

    (reopened,) = enriching.lyrics_match.status(alice, album)
    assert reopened.state == "skipped"
    assert enriching.lyrics.lyrics(track_id) is None


def test_restarting_after_the_search_keeps_the_queued_pick_and_does_not_search_again(
    enriching: Enriching, alice: Account, songs: SongsService
) -> None:
    album, (melt, *_rest) = _album(enriching, alice, songs)
    track_id, root = _waiting_to_choose(enriching, alice, album, melt)
    enriching.jobs.stop()

    with running_enrichment(enriching.units, enriching.clock, enriching.data_dir) as restarted:
        restarted.finish_every_job()
        (reopened,) = restarted.lyrics_match.status(alice, album)
        assert (reopened.job_id, reopened.state) == (root, "saved")
        searches = [
            view.job.id for view in restarted.jobs.list_jobs() if view.job.kind == MATCH_FIND
        ]
        assert searches == [root]
        assert restarted.lyrics.lyrics(track_id) is not None


def test_a_queued_choice_does_not_save_after_restart_without_the_lyrics_finder(
    enriching: Enriching, alice: Account, songs: SongsService, monkeypatch: pytest.MonkeyPatch
) -> None:
    album, (melt, *_rest) = _album(enriching, alice, songs)
    track_id, _ = _waiting_to_choose(enriching, alice, album, melt)
    enriching.jobs.stop()
    available = PluginService.available_keys

    def without_finder(plugins: PluginService) -> dict[str, list[str]]:
        return {
            key: values for key, values in available(plugins).items() if key != LYRICS_FINDER.name
        }

    monkeypatch.setattr(PluginService, "available_keys", without_finder)
    with running_enrichment(enriching.units, enriching.clock, enriching.data_dir) as restarted:
        assert "ai-details" in restarted.plugins.available_keys()[LYRICS_CHOOSER.name]
        restarted.finish_every_job()

        (reopened,) = restarted.lyrics_match.status(alice, album)
        assert reopened.state == "skipped"
        assert "lyrics plugin" in reopened.note
        assert restarted.lyrics.lyrics(track_id) is None


def test_playback_lookup_is_deferred_only_while_auto_match_is_active(
    enriching: Enriching, alice: Account, songs: SongsService
) -> None:
    album, (_, nowhere, _) = _album(enriching, alice, songs)
    other = enriching.add_song("Other")
    old = enriching.lyrics_search.find(alice, other, "Other", "Radiohead")
    enriching.wait_for(old, JobState.SUCCEEDED)
    (match,) = enriching.lyrics_match.start(alice, album, [nowhere])

    with pytest.raises(MedleyplayError) as refused:
        enriching.enrichment.find_details(alice, match.track_id, LYRICS.name)

    assert refused.value.code == "lyrics_match_in_progress"
    enriching.finish_every_job()
    lookup = enriching.enrichment.find_details(alice, match.track_id, LYRICS.name)
    enriching.finish_every_job()
    assert enriching.jobs.get_job(lookup.id).job.state is JobState.SUCCEEDED


@pytest.mark.parametrize("again", [False, True], ids=["ordinary", "forced"])
def test_lookup_rechecks_lyrics_saved_by_auto_match_before_it_queues(
    enriching: Enriching,
    alice: Account,
    songs: SongsService,
    monkeypatch: pytest.MonkeyPatch,
    *,
    again: bool,
) -> None:
    album, (melt, *_rest) = _album(enriching, alice, songs)
    track_id, _ = _waiting_to_choose(enriching, alice, album, melt)
    submit = enriching.jobs.submit
    assert enriching.lyrics.lyrics(track_id) is None

    def finish_match_before_submit(
        kind: JobKind[EnrichJob, EnrichedTrack],
        target: str,
        request: EnrichJob,
        requested_by: AccountId | None,
    ) -> Job:
        enriching.finish_every_job()
        (finished,) = enriching.lyrics_match.status(alice, album)
        assert finished.state == "saved"
        return submit(kind, target, request, requested_by)

    monkeypatch.setattr(enriching.jobs, "submit", finish_match_before_submit)

    if again:
        lookup = enriching.enrichment.find_details(alice, track_id, LYRICS.name, again=True)
        enriching.finish_every_job()
        assert enriching.jobs.get_job(lookup.id).job.state is JobState.SUCCEEDED
    else:
        with pytest.raises(ConflictError, match="already"):
            enriching.enrichment.find_details(alice, track_id, LYRICS.name)

        assert enriching.jobs.latest(ENRICH_KIND, enrich_target(track_id, LYRICS.name)) is None
        kept = enriching.lyrics.lyrics(track_id)
        assert kept is not None
        assert kept.text == lyrics_of("Melt")


def test_a_manual_search_supersedes_auto_match_without_applying_the_old_pick(
    enriching: Enriching, alice: Account, songs: SongsService
) -> None:
    album, (melt, *_rest) = _album(enriching, alice, songs)
    track_id, _ = _waiting_to_choose(enriching, alice, album, melt)

    enriching.lyrics_search.find(alice, track_id, "Another song", "ryo")
    (second,) = enriching.lyrics_match.start(alice, album, [melt])
    enriching.finish_every_job()

    (reopened,) = enriching.lyrics_match.status(alice, album)
    assert (second.job_id, second.state) == (None, "skipped")
    assert "already being looked up" in second.note
    assert reopened.state == "skipped"
    assert enriching.lyrics_search.found(alice, track_id).title == "Another song"
    assert enriching.lyrics.lyrics(track_id) is None


def test_an_old_staged_pick_cannot_save_after_background_auto_match_starts(
    enriching: Enriching, alice: Account, songs: SongsService
) -> None:
    album, (melt, *_rest) = _album(enriching, alice, songs)
    track_id = TrackId(melt.track_id)
    lyrics = enriching.lyrics_search
    old = lyrics.start_match(alice, track_id, melt)
    enriching.wait_for(old, JobState.SUCCEEDED)
    lyrics.choose(alice, track_id, match_job=old)
    choice = enriching.jobs.latest(CHOOSE_LYRICS_KIND, choose_lyrics_target(track_id))
    assert choice is not None
    enriching.wait_for(choice.id, JobState.SUCCEEDED)
    found = lyrics.found(alice, track_id)
    assert found.pick is not None
    enriching.lyrics_match.start(alice, album, [melt])

    with pytest.raises(ConflictError, match="changed"):
        lyrics.apply_match(track_id, old, found.pick.at)

    assert enriching.lyrics.lyrics(track_id) is None


def test_auto_match_skips_a_recording_offered_twice(
    enriching: Enriching, alice: Account, songs: SongsService
) -> None:
    album, (melt, *_rest) = _album(enriching, alice, songs)
    SettingsService(enriching.units, enriching.clock).put(
        alice, Settings(lyrics_sites=(LyricsSite.NETEASE,))
    )

    (match,) = enriching.lyrics_match.start(alice, album, [melt])
    enriching.finish_every_job()

    (reopened,) = enriching.lyrics_match.status(alice, album)
    assert reopened.state == "skipped"
    assert "more than one candidate" in reopened.note
    assert enriching.lyrics.lyrics(match.track_id) is None


def test_conflicting_versions_of_a_song_are_refused_before_any_job_is_queued(
    enriching: Enriching, alice: Account, songs: SongsService
) -> None:
    album, (melt, *_rest) = _album(enriching, alice, songs)
    changed = melt.model_copy(update={"title": "Changed"})

    with pytest.raises(InvalidInputError, match="only one saved row"):
        enriching.lyrics_match.start(alice, album, [melt, changed])

    assert enriching.jobs.list_jobs() == []
