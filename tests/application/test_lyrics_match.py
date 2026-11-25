"""Auto-Match jobs prepare lyric picks for Songs Save."""

from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.accounts import AccountService
from medleyplay.application.enrichment import ENRICH_KIND, enrich_target
from medleyplay.application.jobs import JobKind
from medleyplay.application.lyrics_match import MatchSongInput
from medleyplay.application.lyrics_match_state import MATCH_CHOOSE, MATCH_FIND, match_target
from medleyplay.application.lyrics_search import (
    CHOOSE_LYRICS_KIND,
    choose_lyrics_target,
    store_choice,
)
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
from medleyplay.domain.segments import SegmentId, SongRow
from medleyplay.domain.settings import Settings
from medleyplay.domain.video_text import Song
from medleyplay.persistence.schema import LyricsSearchRow
from medleyplay.plugin_api import LYRICS_CHOOSER, LYRICS_FINDER
from medleyplay.programs.enrich_track import EnrichedTrack, EnrichJob
from medleyplay.programs.find_lyrics import ChosenLyricsResult
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


def _rows(inputs: tuple[MatchSongInput, ...]) -> list[SongRow]:
    return [
        SongRow(SegmentId(row.segment_id), Song(row.start_ms, row.title, row.artist))
        for row in inputs
    ]


def test_auto_match_stages_a_pick_until_songs_save_and_keeps_other_outcomes_separate(
    enriching: Enriching, alice: Account, songs: SongsService
) -> None:
    album, rows = _album(enriching, alice, songs)

    started, *_rest = enriching.lyrics_match.start(alice, album, rows)
    enriching.finish_every_job()

    ready, missed, failed = enriching.lyrics_match.status(alice, album)
    assert [ready.state, missed.state, failed.state] == ["ready", "skipped", "failed"]
    assert ready.choice_job_id is not None
    assert enriching.lyrics.lyrics(ready.track_id) is None
    songs.save(album, _rows(rows))
    assert enriching.lyrics.lyrics(ready.track_id) is None

    songs.save(album, _rows(rows), lyric_picks=[ready.choice_job_id])

    kept = enriching.lyrics.lyrics(ready.track_id)
    assert kept is not None
    assert (kept.origin.value, kept.text) == ("lrclib", lyrics_of("Melt"))
    assert enriching.lyrics.lyrics(missed.track_id) is None
    assert enriching.lyrics.lyrics(failed.track_id) is None
    assert enriching.lyrics_match.status(alice, album)[0].state == "saved"

    (again,) = enriching.lyrics_match.start(alice, album, [rows[0]])
    assert (again.state, again.job_id, again.previous_job_id) == ("skipped", None, started.job_id)


def test_songs_save_confirms_two_ready_picks_even_without_available_providers(
    enriching: Enriching, alice: Account, songs: SongsService, monkeypatch: pytest.MonkeyPatch
) -> None:
    album, rows = _album(enriching, alice, songs)
    first, middle, last = _rows(rows)
    saved = songs.save(album, [first, middle, SongRow(None, Song(270_000, "Encore")), last])
    encore = saved.songs[2]
    second = MatchSongInput(
        track_id=encore.track_id,
        segment_id=encore.id,
        start_ms=encore.start_ms,
        title=encore.title,
        artist=encore.artist,
    )
    enriching.lyrics_match.start(alice, album, [rows[0], second])
    enriching.finish_every_job()
    first_pick, second_pick = enriching.lyrics_match.status(alice, album)
    assert first_pick.choice_job_id is not None
    assert second_pick.choice_job_id is not None
    assert [enriching.lyrics.lyrics(pick.track_id) for pick in (first_pick, second_pick)] == [
        None,
        None,
    ]
    monkeypatch.setattr(PluginService, "available_keys", lambda _: {})
    enriching.online.online = False

    songs.save(
        album,
        _rows((*rows[:2], second, rows[2])),
        lyric_picks=[first_pick.choice_job_id, second_pick.choice_job_id],
    )

    assert [match.state for match in enriching.lyrics_match.status(alice, album)] == [
        "saved",
        "saved",
    ]
    for pick, title in ((first_pick, "Melt"), (second_pick, "Encore")):
        kept = enriching.lyrics.lyrics(pick.track_id)
        assert kept is not None
        assert (kept.origin.value, kept.text) == ("lrclib", lyrics_of(title))


def test_songs_save_does_not_erase_a_concurrent_retime_to_confirm_a_pick(
    enriching: Enriching, alice: Account, songs: SongsService
) -> None:
    album, rows = _album(enriching, alice, songs)
    enriching.lyrics_match.start(alice, album, [rows[0]])
    enriching.finish_every_job()
    (ready,) = enriching.lyrics_match.status(alice, album)
    assert ready.choice_job_id is not None
    moved = _rows(rows)
    moved[1] = SongRow(moved[1].id, Song(250_000, "Nowhere"))
    songs.save(album, moved)

    with pytest.raises(ConflictError, match="changed"):
        songs.save(album, _rows(rows), lyric_picks=[ready.choice_job_id])

    assert songs.songs(album).songs[1].start_ms == 250_000
    assert enriching.lyrics.lyrics(ready.track_id) is None


def test_songs_save_rolls_back_a_row_edit_that_changes_a_confirmed_recording(
    enriching: Enriching, alice: Account, songs: SongsService
) -> None:
    album, rows = _album(enriching, alice, songs)
    enriching.lyrics_match.start(alice, album, [rows[0]])
    enriching.finish_every_job()
    (ready,) = enriching.lyrics_match.status(alice, album)
    assert ready.choice_job_id is not None
    retimed = _rows(rows)
    retimed[1] = SongRow(retimed[1].id, Song(250_000, "Nowhere"))

    with pytest.raises(ConflictError, match="changed"):
        songs.save(album, retimed, lyric_picks=[ready.choice_job_id])

    assert songs.songs(album).songs[1].start_ms == 260_000
    assert enriching.lyrics.lyrics(ready.track_id) is None
    assert enriching.lyrics_match.status(alice, album)[0].state == "ready"


def test_manually_saving_and_removing_lyrics_invalidates_an_unsaved_pick(
    enriching: Enriching, alice: Account, songs: SongsService
) -> None:
    album, rows = _album(enriching, alice, songs)
    enriching.lyrics_match.start(alice, album, [rows[0]])
    enriching.finish_every_job()
    (ready,) = enriching.lyrics_match.status(alice, album)
    assert ready.choice_job_id is not None

    enriching.lyrics.set_own(ready.track_id, "Our lyrics")
    enriching.lyrics.forget_own(ready.track_id)

    with pytest.raises(ConflictError, match="changed"):
        songs.save(album, _rows(rows), lyric_picks=[ready.choice_job_id])
    assert enriching.lyrics.lyrics(ready.track_id) is None


@pytest.mark.parametrize("choose", [False, True], ids=["search", "choice"])
def test_retrying_an_older_manual_lyrics_job_invalidates_the_ready_pick_at_submission(
    enriching: Enriching, alice: Account, songs: SongsService, *, choose: bool
) -> None:
    album, rows = _album(enriching, alice, songs)
    melt = rows[0]
    track_id = TrackId(melt.track_id)
    lyrics = enriching.lyrics_search
    if choose:
        first = lyrics.find(alice, track_id, melt.title, melt.artist)
        enriching.wait_for(first, JobState.SUCCEEDED)
    enriching.online.online = False
    if choose:
        lyrics.choose(alice, track_id)
        choice = enriching.jobs.latest(CHOOSE_LYRICS_KIND, choose_lyrics_target(track_id))
        assert choice is not None
        old = choice.id
    else:
        old = lyrics.find(alice, track_id, melt.title, melt.artist)
    enriching.jobs.cancel(alice, old)
    enriching.online.online = True
    enriching.lyrics_match.start(alice, album, [melt])
    enriching.finish_every_job()
    (ready,) = enriching.lyrics_match.status(alice, album)
    assert ready.choice_job_id is not None

    enriching.online.online = False
    retried = enriching.jobs.retry(alice, old)

    assert retried.state == JobState.QUEUED
    with pytest.raises(ConflictError, match="changed"):
        songs.save(album, _rows(rows), lyric_picks=[ready.choice_job_id])
    assert enriching.lyrics.lyrics(track_id) is None


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


def test_a_replacement_choice_cannot_be_confirmed_by_the_earlier_pick_id(
    enriching: Enriching, alice: Account, songs: SongsService
) -> None:
    album, rows = _album(enriching, alice, songs)
    enriching.lyrics_match.start(alice, album, [rows[0]])
    enriching.finish_every_job()
    (ready,) = enriching.lyrics_match.status(alice, album)
    assert ready.choice_job_id is not None
    with enriching.units.begin() as db:
        search = db.get_one(LyricsSearchRow, ready.track_id)
        replacement = ChosenLyricsResult(
            track_id=ready.track_id, offered=tuple(search.offered), option=1, why="The live take."
        )
        assert store_choice(db, search, replacement, enriching.clock) is not None

    with pytest.raises(ConflictError, match="changed"):
        songs.save(album, _rows(rows), lyric_picks=[ready.choice_job_id])

    assert enriching.lyrics.lyrics(ready.track_id) is None


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
        assert (reopened.job_id, reopened.state) == (root, "ready")
        searches = [
            view.job.id for view in restarted.jobs.list_jobs() if view.job.kind == MATCH_FIND
        ]
        assert searches == [root]
        assert restarted.lyrics.lyrics(track_id) is None


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
        assert finished.state == "ready"
        assert finished.choice_job_id is not None
        songs.save(album, _rows((melt, *_rest)), lyric_picks=[finished.choice_job_id])
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
