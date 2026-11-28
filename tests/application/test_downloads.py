"""Downloading a Bilibili Source in a real Job, through the test plugin `tube`, and playing it."""

import os
import threading
import time
from collections.abc import Iterator
from datetime import timedelta
from pathlib import Path

import pytest
from sqlalchemy import event, select, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application import downloads as download_app
from medleyplay.application.accounts import AccountService
from medleyplay.application.job_runner import NETWORK_RETRY, JobRunner, _Outcome, _Running
from medleyplay.application.links import Added, AlbumChoice, PartChoice
from medleyplay.application.playback import Preparing, Ready, Unplayable
from medleyplay.domain.accounts import Account
from medleyplay.domain.catalog import Availability, SourceState
from medleyplay.domain.downloads import DOWNLOAD_EXTENSIONS, download_target
from medleyplay.domain.errors import ConflictError, NotFoundError
from medleyplay.domain.jobs import JobId, JobState, JobView
from medleyplay.domain.linked_accounts import LinkState
from medleyplay.domain.plugins import PluginState
from medleyplay.download_limits import MAX_DOWNLOAD_BYTES
from medleyplay.persistence.schema import DownloadRow, JobRow, SourceRow
from medleyplay.plugin_host.job_wire import JobFailed, JobFinished
from medleyplay.programs.download_source import DownloadSource
from tests.support.audio import Song, wav_bytes
from tests.support.factories import NewAccountFactory
from tests.support.fakes import FakeClock, MemorySecrets
from tests.support.sites import Site, running_site

SESSION = ".bilibili.com\tTRUE\t/\tTRUE\t0\tSESSDATA\tsecret-session"
COOKIES = f"# Netscape HTTP Cookie File\n{SESSION}\n"


@pytest.fixture
def alice(accounts: AccountService) -> Account:
    return accounts.create_first_admin(NewAccountFactory.admin()).account


@pytest.fixture
def site(
    units: sessionmaker[Session], clock: FakeClock, tmp_path: Path, secrets: MemorySecrets
) -> Iterator[Site]:
    with running_site(units, clock, tmp_path / "data", secrets) as running:
        yield running


def _added(site: Site, alice: Account, video: str, quality: str = "best") -> Added:
    """Add the first part of `video`, as the household would from its link."""
    link = f"https://www.bilibili.com/video/{video}"
    return site.links.add(alice, link, quality, [PartChoice(1, "Night Drive", "Blue Room")])[0]


def _finished(site: Site, added: Added) -> JobView:
    assert added.job is not None
    return site.wait_for(added.job.id, JobState.SUCCEEDED)


def _failed(site: Site, added: Added) -> JobView:
    """Wait for the Job's first failure: final, or before its next attempt."""
    assert added.job is not None
    return site.wait_for(
        added.job.id,
        JobState.QUEUED,
        JobState.FAILED,
        until=lambda view: view.job.failure_kind is not None,
    )


def _job_id(added: Added) -> JobId:
    assert added.job is not None
    return added.job.id


def _wait_until_gone(path: Path) -> None:
    """Wait for the runner to remove a finished Job's working folder, as it does after settling."""
    ends = time.monotonic() + 10
    while path.exists():
        assert time.monotonic() < ends, f"{path} is still there."
        time.sleep(0.05)


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_a_download_is_saved_under_an_owned_name_and_plays(
    site: Site, alice: Account, units: sessionmaker[Session], clock: FakeClock
) -> None:
    added = _added(site, alice, "BV1Xx41117Tz")

    _finished(site, added)

    file = site.saved_file(added.source_id)
    assert file.name.startswith(f"{added.source_id}-")
    assert file.suffix == ".m4a"
    assert _read(file) == "BV1Xx41117Tz/p1 quality=30280 login=none mode=none"
    with units() as db:
        row = db.get_one(DownloadRow, added.source_id)
        assert (row.file_name, row.quality, row.backend, row.size, row.downloaded_at) == (
            file.name,
            "30280",
            "tube",
            file.stat().st_size,
            clock.now,
        )
    assert site.playback.play(alice, added.track_id) == Ready(added.source_id, "audio/mp4")
    audio = site.playback.open_audio(added.source_id)
    try:
        assert os.pread(audio.descriptor, audio.length, 0) == file.read_bytes()
    finally:
        audio.close()


def test_a_download_asks_for_the_quality_chosen_when_adding(site: Site, alice: Account) -> None:
    added = _added(site, alice, "BV1Xx41117Tz", quality="30216")

    _finished(site, added)

    assert "quality=30216" in _read(site.saved_file(added.source_id))


def test_a_job_cannot_replace_the_saved_audio_if_the_commit_fails(
    site: Site, alice: Account, units: sessionmaker[Session]
) -> None:
    added = _added(site, alice, "BV1Xx41117Tz")
    _finished(site, added)

    def reject_replacement(db: Session) -> None:
        if db.get_one(DownloadRow, added.source_id).quality == "30216":
            message = "Synthetic database commit failure."
            raise SQLAlchemyError(message)

    event.listen(units, "before_commit", reject_replacement)
    try:
        replacement = site.jobs.submit(
            site.download_kind,
            download_target(added.source_id),
            DownloadSource(
                site="bilibili",
                video="BV1Xx41117Tz",
                part=1,
                quality="30216",
                extensions=DOWNLOAD_EXTENSIONS,
                max_bytes=MAX_DOWNLOAD_BYTES,
            ),
            alice.id,
        )
        failed = site.wait_for(replacement.id, JobState.FAILED)
    finally:
        event.remove(units, "before_commit", reject_replacement)

    assert failed.job.failure_kind == "attempt_uncertain"
    audio = site.playback.open_audio(added.source_id)
    try:
        assert b"quality=30280" in os.pread(audio.descriptor, audio.length, 0)
    finally:
        audio.close()


def test_an_upload_that_wins_commit_cannot_be_overwritten_by_a_late_job_result(
    site: Site,
    alice: Account,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    received, release = threading.Event(), threading.Event()
    watch = JobRunner._watch  # noqa: SLF001 -- pause after reading the worker's result

    def wait_for_upload(runner: JobRunner, job: _Running) -> _Outcome:
        outcome = watch(runner, job)
        if job.kind.name == site.download_kind.name and isinstance(outcome, JobFinished):
            received.set()
            release.wait(20)
        return outcome

    monkeypatch.setattr(JobRunner, "_watch", wait_for_upload)
    added = _added(site, alice, "BV1Xx41117Tz")
    job = _job_id(added)
    audio = wav_bytes(Song(seconds=2))
    try:
        assert received.wait(20)
        with site.manual.upload(added.track_id, "local.wav") as upload:
            upload.write(audio)
            upload.finish()
    finally:
        release.set()

    _wait_until_gone(site.data_dir / "jobs" / str(job))
    assert site.jobs.get_job(job).job.state is JobState.CANCELLED
    assert site.saved_file(added.source_id).read_bytes() == audio
    assert list(site.downloads.folder.glob("*.m4a")) == []


def test_a_download_gets_a_copy_of_the_valid_login_only_its_owner_reads(
    site: Site, alice: Account
) -> None:
    site.linked.save(alice, "bilibili", COOKIES)

    added = _added(site, alice, "BVSignedIn")
    view = _finished(site, added)

    said = _read(site.saved_file(added.source_id))
    assert said == f"BVSignedIn/p1 quality=30280 login={SESSION} mode=0o600"
    _wait_until_gone(site.data_dir / "jobs" / str(view.job.id))


def test_a_download_that_needs_a_login_fails_without_one_saying_so(
    site: Site, alice: Account
) -> None:
    view = _failed(site, _added(site, alice, "BVSignedIn"))

    assert (view.job.failure_kind, "refused the login" in view.job.failure_message) == (
        "auth",
        True,
    )


def test_a_login_the_site_refuses_needs_sign_in(site: Site, alice: Account) -> None:
    site.linked.save(alice, "bilibili", COOKIES)

    _failed(site, _added(site, alice, "BVrefused"))

    assert [each.state for each in site.linked.list_linked(alice)] == [LinkState.NEEDS_SIGN_IN]


@pytest.mark.parametrize("go_offline", [False, True], ids=["online", "offline-after-rejection"])
def test_a_provider_rejection_does_not_spend_retries_or_revoke_a_valid_login(
    site: Site, alice: Account, monkeypatch: pytest.MonkeyPatch, *, go_offline: bool
) -> None:
    watch = JobRunner._watch  # noqa: SLF001 -- hold the recovered outcome before it is saved

    def watch_until_offline(runner: JobRunner, running: _Running) -> _Outcome:
        outcome = watch(runner, running)
        if go_offline and isinstance(outcome, JobFailed) and outcome.kind == "provider_refused":
            site.online.online = False
            runner.follow_mode()
        return outcome

    monkeypatch.setattr(JobRunner, "_watch", watch_until_offline)
    site.linked.save(alice, "bilibili", COOKIES)
    added = _added(site, alice, "BVProviderRefused")

    failed = _failed(site, added).job

    assert (failed.state, failed.failure_kind, failed.attempts) == (
        JobState.FAILED,
        "attempt_uncertain" if go_offline else "provider_refused",
        0,
    )
    assert site.jobs.download_diagnostics(alice, failed.id).hold == failed.failure_kind
    with pytest.raises(ConflictError, match="held"):
        site.jobs.retry(alice, failed.id)
    assert site.downloads.start_for(alice.id, added.source_id) is None
    assert [each.state for each in site.linked.list_linked(alice)] == [LinkState.VALID]
    assert not list(site.downloads.folder.glob("*.m4a"))


def test_a_failure_message_never_keeps_the_login(site: Site, alice: Account) -> None:
    site.linked.save(alice, "bilibili", COOKIES)

    view = _failed(site, _added(site, alice, "BVleaky"))

    assert view.job.failure_message == "The download adapter failed."


def test_a_long_plugin_error_keeps_its_typed_failure_without_placing_a_hold(
    site: Site, alice: Account, units: sessionmaker[Session]
) -> None:
    added = _added(site, alice, "BVLongFault")

    failed = site.wait_for(_job_id(added), JobState.FAILED)
    trace = site.jobs.download_diagnostics(alice, failed.job.id)

    assert (failed.job.failure_kind, trace.hold) == ("plugin", None)
    assert trace.events[-1].reason == "plugin"
    with units() as db:
        assert db.get_one(JobRow, failed.job.id).failure_message == "The download adapter failed."


def test_a_part_the_site_no_longer_has_makes_its_source_unavailable(
    site: Site, alice: Account, units: sessionmaker[Session]
) -> None:
    added = _added(site, alice, "BVremoved")

    _finished(site, added)

    assert site.manual.state(added.track_id).latest_job_id == _job_id(added)
    with units() as db:
        assert db.get_one(SourceRow, added.source_id).state == SourceState.UNAVAILABLE
    assert site.playback.play(alice, added.track_id) == Unplayable(Availability.UNAVAILABLE)
    with pytest.raises(NotFoundError):
        site.playback.open_audio(added.source_id)


@pytest.mark.parametrize(
    "video",
    [
        "BVescape",
        "BVtext",
        "BVempty",
        "BVlink",
    ],
)
def test_a_file_the_core_cant_trust_fails_the_download_without_exposing_its_path(
    site: Site, alice: Account, video: str
) -> None:
    view = _failed(site, _added(site, alice, video))

    assert view.job.failure_kind == "invalid_artifact"
    assert view.job.failure_message == "The download did not produce a valid audio file."
    assert not list((site.data_dir / "downloads").glob("*"))


def test_a_download_still_plays_when_its_source_is_unavailable_since(
    site: Site, alice: Account, units: sessionmaker[Session]
) -> None:
    added = _added(site, alice, "BV1Xx41117Tz")
    _finished(site, added)
    with units.begin() as db:
        db.execute(update(SourceRow).values(state=SourceState.UNAVAILABLE))

    assert site.playback.play(alice, added.track_id) == Ready(added.source_id, "audio/mp4")
    site.playback.open_audio(added.source_id).close()
    track = site.catalog.get_track(alice.id, added.track_id)
    assert track.availability is Availability.OK


def test_a_track_counts_as_downloaded_once_its_download_finishes(
    site: Site, alice: Account
) -> None:
    added = _added(site, alice, "BV1Xx41117Tz")
    before = site.catalog.get_track(alice.id, added.track_id)

    _finished(site, added)

    assert not before.downloaded
    assert site.catalog.get_track(alice.id, added.track_id).downloaded
    assert [track.downloaded for track in site.catalog.list_tracks(alice.id)] == [True]


def test_a_source_without_a_download_answers_preparing_with_its_download(
    site: Site, alice: Account, units: sessionmaker[Session]
) -> None:
    added = _added(site, alice, "BV1Xx41117Tz")
    _finished(site, added)
    site.saved_file(added.source_id).unlink()

    preparing = site.playback.play(alice, added.track_id)

    assert not isinstance(preparing, Ready | Unplayable)
    assert preparing.job.target == f"source:{added.source_id}"


def test_the_sweep_removes_files_no_download_names(
    site: Site, alice: Account, units: sessionmaker[Session]
) -> None:
    added = _added(site, alice, "BV1Xx41117Tz")
    _finished(site, added)
    stray = site.data_dir / "downloads" / "99.m4a"
    stray.write_text("left by a crash", encoding="utf-8")

    site.playback.sweep_downloads()

    with units() as db:
        named = list(db.scalars(select(DownloadRow.file_name)))
    assert sorted(path.name for path in (site.data_dir / "downloads").iterdir()) == named


def test_a_plugin_fault_never_keeps_the_login(site: Site, alice: Account) -> None:
    site.linked.save(alice, "bilibili", COOKIES)
    first = site.wait_for(_job_id(_added(site, alice, "BVleaky")), JobState.FAILED)
    failed = first
    for _ in range(4):
        failed = site.wait_for(site.jobs.retry(alice, failed.job.id).id, JobState.FAILED)

    assert first.job.failure_message == "The download adapter failed."

    [tube] = [each for each in site.plugins.statuses(alice) if each.name == "tube"]
    assert tube.state is PluginState.FAULTED
    assert tube.reason == "The download adapter failed."


def test_a_media_stop_blocks_an_overlapping_join_and_retries_but_not_other_parts(
    site: Site, alice: Account, units: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    link = "https://www.bilibili.com/video/BVMediaStop"
    lookup = site.video_lookups.start(alice, link)
    site.wait_for(lookup.id, JobState.SUCCEEDED)
    monkeypatch.setattr(download_app, "join_tools", lambda: ("ffmpeg", "ffprobe"))
    resolve = site.links.require_online
    monkeypatch.setattr(site.links, "require_online", lambda: None)
    site.online.online = False
    [part] = site.links.add(alice, link, "best", [PartChoice(1, "Opening", "")])
    [joined] = site.video_lookups.import_parts(
        alice, lookup.id, "best", AlbumChoice("Mixtape", "", joined=True), [1, 2]
    )
    monkeypatch.setattr(site.links, "require_online", resolve)
    site.online.online = True

    failed = site.wait_for(_job_id(part), JobState.FAILED).job
    blocked = site.wait_for(_job_id(joined), JobState.FAILED).job

    assert failed.failure_kind == "response_unknown"
    assert "HTTP 567" in failed.failure_message
    assert "held" in blocked.failure_message
    with units() as db:
        assert db.get_one(JobRow, failed.id).provider_attempts == 1
        assert db.get_one(JobRow, blocked.id).provider_attempts == 0
    with pytest.raises(ConflictError, match="held"):
        site.jobs.retry(alice, failed.id)
    assert site.downloads.start_for(alice.id, part.source_id) is None
    assert site.playback.play(alice, part.track_id) == Unplayable(Availability.UNAVAILABLE)
    with pytest.raises(ConflictError, match="held"):
        site.links.add(alice, link, "best", [PartChoice(1, "Opening", "")])
    [other] = site.links.add(alice, link, "best", [PartChoice(3, "Closing", "")])
    _finished(site, other)


@pytest.mark.parametrize("recovers", [False, True])
def test_a_temporary_failure_uses_one_budget_for_the_same_job(
    site: Site, alice: Account, units: sessionmaker[Session], clock: FakeClock, *, recovers: bool
) -> None:
    added = _added(site, alice, "BVMaintenance")
    job_id = _job_id(added)

    for attempt in (1, 2):
        wait = site.wait_for(
            job_id,
            JobState.WAITING,
            until=lambda view: view.job.started_at == clock(),
        )
        assert wait.job.failure_kind == "network"
        assert wait.retry_at == clock() + NETWORK_RETRY * attempt
        receipt = site.jobs.download_diagnostics(alice, job_id).events[-1]
        assert (receipt.event, receipt.http_status) == ("waiting", 503)
        with units() as db:
            assert db.get_one(JobRow, job_id).provider_attempts == attempt
        if recovers and attempt == 2:
            (site.data_dir / "provider-ready").touch()
        clock.advance(NETWORK_RETRY * attempt)

    if recovers:
        _finished(site, added)
    else:
        failed = site.wait_for(job_id, JobState.FAILED).job
        assert failed.failure_kind == "retry_exhausted"
        assert site.downloads.start_for(alice.id, added.source_id) is None
    with units() as db:
        assert db.get_one(JobRow, job_id).provider_attempts == 3


def test_a_scheduled_retry_never_switches_to_a_new_proxy(
    site: Site, alice: Account, units: sessionmaker[Session], clock: FakeClock
) -> None:
    site.proxies.save(alice, "bilibili", "http://first-proxy.test:8080")
    added = _added(site, alice, "BVMaintenance")
    job = _job_id(added)
    site.wait_for(job, JobState.WAITING)

    site.proxies.save(alice, "bilibili", "http://second-proxy.test:8080")
    (site.data_dir / "provider-ready").touch()
    clock.advance(NETWORK_RETRY)

    stopped = site.wait_for(job, JobState.FAILED)
    assert stopped.job.failure_kind == "route_changed"
    assert site.downloads.start_for(alice.id, added.source_id) is None
    with units() as db:
        assert db.get_one(JobRow, job).provider_attempts == 1


def test_an_outcome_received_after_going_offline_cannot_publish_audio(
    site: Site,
    alice: Account,
) -> None:
    added = _added(site, alice, "BVProxyProgress")
    job = _job_id(added)
    site.wait_for(job, JobState.RUNNING, until=lambda view: view.progress is not None)
    with pytest.raises(ConflictError, match="busy"):
        site.links.lookup(alice, "https://www.bilibili.com/video/BV1Xx41117Tz")

    site.online.online = False
    stopped = site.wait_for(job, JobState.FAILED)
    site.online.online = True

    assert stopped.job.failure_kind == "attempt_uncertain"
    assert site.playback.play(alice, added.track_id) == Unplayable(Availability.UNAVAILABLE)
    with pytest.raises(ConflictError, match="held"):
        site.jobs.retry(alice, job)


def test_retrying_a_download_uses_the_login_saved_since_it_failed(
    site: Site, alice: Account
) -> None:
    failed = _failed(site, _added(site, alice, "BVSignedIn"))
    site.linked.save(alice, "bilibili", COOKIES)

    retried = site.jobs.retry(alice, failed.job.id)

    site.wait_for(retried.id, JobState.SUCCEEDED)


def test_a_job_whose_account_is_gone_borrows_no_login(site: Site, alice: Account) -> None:
    added = _added(site, alice, "BV1Xx41117Tz")
    _finished(site, added)
    site.linked.save(alice, "bilibili", COOKIES)
    request = DownloadSource(
        site="bilibili",
        video="BV1Xx41117Tz",
        part=1,
        quality="best",
        extensions=DOWNLOAD_EXTENSIONS,
        max_bytes=MAX_DOWNLOAD_BYTES,
    )

    # A Job outlives the Account that asked for it, whose id a new Account may take.
    job = site.jobs.submit(
        site.download_kind, download_target(added.source_id), request, None, login_account=alice.id
    )
    site.wait_for(job.id, JobState.SUCCEEDED)

    said = _read(site.saved_file(added.source_id))
    assert said == "BV1Xx41117Tz/p1 quality=30280 login=none mode=none"


def test_a_download_waits_while_the_keychain_does_not_answer(
    site: Site, alice: Account, clock: FakeClock
) -> None:
    site.linked.save(alice, "bilibili", COOKIES)
    site.secrets.unavailable = True
    added = _added(site, alice, "BVSignedIn")
    waiting = site.wait_for(_job_id(added), JobState.WAITING)

    site.secrets.unavailable = False
    clock.advance(NETWORK_RETRY)

    site.wait_for(_job_id(added), JobState.SUCCEEDED)
    assert (waiting.job.failure_kind, waiting.job.attempts) == ("keychain", 0)
    assert "Keychain" in waiting.job.failure_message


def test_playing_a_track_whose_download_failed_answers_that_job_rather_than_a_new_one(
    site: Site, alice: Account
) -> None:
    added = _added(site, alice, "BVSignedIn")
    failed = _failed(site, added)

    preparing = site.playback.play(alice, added.track_id)

    assert preparing == Preparing(added.source_id, failed.job)


def test_serving_a_download_records_when_at_most_once_a_minute(
    site: Site, alice: Account, units: sessionmaker[Session], clock: FakeClock
) -> None:
    added = _added(site, alice, "BV1Xx41117Tz")
    _finished(site, added)
    first_served = clock.now

    site.playback.open_audio(added.source_id).close()
    clock.advance(timedelta(seconds=30))
    site.playback.open_audio(added.source_id).close()

    with units() as db:
        assert db.get_one(DownloadRow, added.source_id).last_served_at == first_served
    clock.advance(timedelta(minutes=1))
    site.playback.open_audio(added.source_id).close()
    with units() as db:
        assert db.get_one(DownloadRow, added.source_id).last_served_at == clock.now


def test_the_policy_starts_a_download_again_after_one_failed(site: Site, alice: Account) -> None:
    added = _added(site, alice, "BVSignedIn")
    failed = _failed(site, added)

    again = site.downloads.start_for(alice.id, added.source_id)

    assert again is not None
    assert again.id != failed.job.id


def test_the_policy_never_downloads_a_source_already_downloaded(site: Site, alice: Account) -> None:
    added = _added(site, alice, "BV1Xx41117Tz")
    _finished(site, added)

    assert site.downloads.start_for(alice.id, added.source_id) is None


def test_offline_a_track_to_download_waits_for_online_and_its_download_waits_queued(
    site: Site, alice: Account
) -> None:
    added = _added(site, alice, "BV1Xx41117Tz")
    _finished(site, added)
    site.saved_file(added.source_id).unlink()
    site.online.online = False

    played = site.playback.play(alice, added.track_id)
    job = site.jobs.active(site.download_kind.name, download_target(added.source_id))

    assert played == Unplayable(Availability.WAITING_ONLINE)
    assert job is not None
    held = site.jobs.get_job(job.id)
    assert (held.job.state, held.waits_for_online) == (JobState.QUEUED, True)
