"""A site Track's Download as the household sees it, and the file they add by hand.

Downloads fail, finish, and are replaced through the test plugin `tube`; the files
added are small audio files the tests make.
"""

import tempfile
from collections.abc import Iterator
from pathlib import Path

import pytest
from hypothesis import given
from hypothesis import strategies as st
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.accounts import AccountService
from medleyplay.application.downloads import DOWNLOAD_KIND
from medleyplay.application.links import PartChoice
from medleyplay.application.manual_downloads import (
    DownloadStatus,
    ManualDownloadService,
    TrackDownload,
    audio_length_ms,
)
from medleyplay.application.playback import Ready
from medleyplay.domain.accounts import Account
from medleyplay.domain.catalog import SourceId, SourceKey, SourceState, TrackDetails, TrackId
from medleyplay.domain.downloads import MANUAL_BACKEND, MANUAL_EXTENSIONS, download_target
from medleyplay.domain.errors import (
    ConflictError,
    InvalidInputError,
    NotFoundError,
    TooLargeError,
)
from medleyplay.domain.jobs import JobState
from medleyplay.persistence.schema import DownloadRow, SourceRow, TrackRow
from tests.support.audio import Song, mp3_bytes, wav_bytes
from tests.support.factories import NewAccountFactory
from tests.support.fakes import FakeClock, MemorySecrets
from tests.support.mp4 import Mp4, mp4_bytes
from tests.support.sites import Site, add_first_part, running_site


@pytest.fixture
def alice(accounts: AccountService) -> Account:
    return accounts.create_first_admin(NewAccountFactory.admin()).account


@pytest.fixture
def site(
    units: sessionmaker[Session], clock: FakeClock, tmp_path: Path, secrets: MemorySecrets
) -> Iterator[Site]:
    with running_site(units, clock, tmp_path / "data", secrets) as running:
        yield running


def _downloads_folder(site: Site) -> Path:
    return site.data_dir / "downloads"


def _two_second_wav() -> bytes:
    return wav_bytes(Song(seconds=2))


def _with_limit(
    site: Site, units: sessionmaker[Session], clock: FakeClock, limit: int
) -> ManualDownloadService:
    """A service like the site's that takes files of at most `limit` bytes."""
    return ManualDownloadService(units, clock, site.jobs, site.downloads.folder, max_bytes=limit)


def _failed_part(site: Site, alice: Account, video: str = "BVrefused") -> TrackId:
    """Add a part whose Download fails at once, with the login refused, and wait for that."""
    added = add_first_part(site, alice, video)
    assert added.job is not None
    site.wait_for(added.job.id, JobState.FAILED)
    return added.track_id


def _downloaded_part(site: Site, alice: Account, video: str = "BV1Xx41117Tz") -> TrackId:
    added = add_first_part(site, alice, video)
    assert added.job is not None
    site.wait_for(added.job.id, JobState.SUCCEEDED)
    return added.track_id


def _library_track(site: Site) -> TrackId:
    """A Track whose only Source is a file in a Library."""
    return site.catalog.add_track(SourceKey("library", "1/Blue/Intro.wav"), TrackDetails("Intro"))


def _waiting_track(site: Site, alice: Account, units: sessionmaker[Session]) -> TrackId:
    """A Track whose Download Job waits, since the Mode is Offline."""
    site.online.online = False
    track_id = site.catalog.add_track(SourceKey("bilibili", "BV1Xx41117Tz/p1"), TrackDetails("A"))
    site.downloads.start(alice, _source_of(units, track_id))
    return track_id


def _source_of(units: sessionmaker[Session], track_id: TrackId) -> SourceId:
    with units() as db:
        return SourceId(
            db.scalars(select(SourceRow.id).where(SourceRow.track_id == track_id)).one()
        )


def _store(
    manual: ManualDownloadService, track_id: TrackId, name: str, content: bytes
) -> TrackDownload:
    """Add `content` as the Track's file named `name`, arriving 100 bytes at a time."""
    with manual.upload(track_id, name) as upload:
        for start in range(0, len(content), 100):
            upload.write(content[start : start + 100])
        return upload.finish()


def _listed(site: Site, alice: Account, track_id: TrackId) -> tuple[bool, bool, str | None]:
    track = next(each for each in site.catalog.list_tracks(alice.id) if each.id == track_id)
    return track.downloaded, track.download_failed, track.site


def test_a_track_whose_download_failed_is_listed_as_download_failed(
    site: Site, alice: Account
) -> None:
    track_id = _failed_part(site, alice)

    assert _listed(site, alice, track_id) == (False, True, "bilibili")


def test_a_track_with_a_finished_download_is_downloaded_and_not_download_failed(
    site: Site, alice: Account
) -> None:
    track_id = _downloaded_part(site, alice)

    assert _listed(site, alice, track_id) == (True, False, "bilibili")


def test_a_retried_download_is_not_failed_while_it_waits_for_online(
    site: Site, alice: Account, units: sessionmaker[Session]
) -> None:
    track_id = _failed_part(site, alice)
    failed = site.jobs.latest(DOWNLOAD_KIND, download_target(_source_of(units, track_id)))
    assert failed is not None
    site.online.online = False

    site.jobs.retry(alice, failed.id)

    assert _listed(site, alice, track_id)[1] is False


def test_a_track_is_download_failed_when_fetched_by_itself(site: Site, alice: Account) -> None:
    track_id = _failed_part(site, alice)

    assert site.catalog.get_track(alice.id, track_id).download_failed


def test_a_library_track_names_no_site_and_is_never_download_failed(
    site: Site, alice: Account
) -> None:
    track_id = _library_track(site)

    assert _listed(site, alice, track_id) == (False, False, None)


def test_a_failed_download_is_reported_with_its_link_and_the_failure_message(
    site: Site, alice: Account
) -> None:
    track_id = _failed_part(site, alice, "BVrefused")

    state = site.manual.state(track_id)

    assert (state.status, state.message, state.kind) == (
        DownloadStatus.FAILED,
        "Bilibili refused the login.",
        "bilibili",
    )
    assert state.link == "https://www.bilibili.com/video/BVrefused?p=1"


def test_a_download_that_waits_is_reported_as_downloading(
    site: Site, alice: Account, units: sessionmaker[Session]
) -> None:
    track_id = _waiting_track(site, alice, units)

    assert site.manual.state(track_id).status is DownloadStatus.DOWNLOADING


def test_a_finished_download_is_reported_with_the_backend_that_made_it(
    site: Site, alice: Account
) -> None:
    track_id = _downloaded_part(site, alice)

    state = site.manual.state(track_id)

    assert (state.status, state.backend) == (DownloadStatus.DOWNLOADED, "tube")


def test_a_part_the_site_no_longer_has_is_reported_as_unavailable(
    site: Site, alice: Account, units: sessionmaker[Session]
) -> None:
    added = add_first_part(site, alice, "BVgone")
    assert added.job is not None
    site.wait_for(added.job.id, JobState.SUCCEEDED)

    state = site.manual.state(added.track_id)

    assert state.status is DownloadStatus.UNAVAILABLE
    with units() as db:
        assert db.get_one(SourceRow, state.source_id).state == SourceState.UNAVAILABLE


def test_a_part_never_downloaded_is_reported_as_having_no_download(site: Site) -> None:
    track_id = site.catalog.add_track(SourceKey("bilibili", "BVgone/p2"), TrackDetails("A"))

    state = site.manual.state(track_id)

    assert (state.status, state.message, state.link) == (
        DownloadStatus.NONE,
        "",
        "https://www.bilibili.com/video/BVgone?p=2",
    )


def test_a_track_with_no_site_source_has_no_download_to_report(site: Site) -> None:
    with pytest.raises(ConflictError):
        site.manual.state(_library_track(site))


def test_a_track_that_does_not_exist_has_no_download_to_report(site: Site) -> None:
    with pytest.raises(NotFoundError):
        site.manual.state(TrackId(404))


@pytest.mark.parametrize(
    ("name", "content", "media"),
    [
        ("night.wav", _two_second_wav(), "audio/wav"),
        ("night.mp3", mp3_bytes(Song(seconds=2)), "audio/mpeg"),
        ("night.m4a", mp4_bytes(Mp4(header_seconds=2)), "audio/mp4"),
        ("night.mp4", mp4_bytes(Mp4(header_seconds=2)), "audio/mp4"),
        ("NIGHT.WAV", _two_second_wav(), "audio/wav"),
    ],
    ids=["wav", "mp3", "m4a", "mp4", "upper case"],
)
def test_a_file_is_kept_as_the_downloads_file_named_by_its_source_and_plays(
    site: Site,
    alice: Account,
    units: sessionmaker[Session],
    clock: FakeClock,
    name: str,
    content: bytes,
    media: str,
) -> None:
    track_id = _failed_part(site, alice)
    source_id = _source_of(units, track_id)

    stored = _store(site.manual, track_id, name, content)

    file = _downloads_folder(site) / f"{source_id}.{name.rsplit('.', 1)[1].lower()}"
    assert file.read_bytes() == content
    assert stored.status is DownloadStatus.DOWNLOADED
    with units() as db:
        row = db.get_one(DownloadRow, source_id)
        assert (row.file_name, row.quality, row.backend, row.size, row.downloaded_at) == (
            file.name,
            "",
            MANUAL_BACKEND,
            len(content),
            clock.now,
        )
    assert site.playback.play(alice, track_id) == Ready(source_id, media)
    assert _listed(site, alice, track_id) == (True, False, "bilibili")


@pytest.mark.parametrize(
    "name",
    ["night.txt", "night.wma", "night.m4a.exe", "night", ".wav", "night."],
    ids=["text", "a type the list leaves out", "another last extension", "none", "dot", "ends"],
)
def test_a_name_without_an_accepted_extension_is_refused_and_nothing_is_kept(
    site: Site, alice: Account, units: sessionmaker[Session], name: str
) -> None:
    track_id = _failed_part(site, alice)

    with pytest.raises(InvalidInputError):
        _store(site.manual, track_id, name, _two_second_wav())

    assert not _downloads_folder(site).exists() or list(_downloads_folder(site).iterdir()) == []
    with units() as db:
        assert db.scalars(select(DownloadRow)).all() == []


@pytest.mark.parametrize(
    ("name", "content"),
    [
        ("night.wav", b""),
        ("night.mp3", b"This is a note, not music."),
        ("night.mp3", _two_second_wav()),
        ("night.m4a", mp4_bytes(Mp4(header_seconds=0))),
    ],
    ids=["empty", "text", "a file of another type", "no length"],
)
def test_a_file_that_is_not_audio_with_a_length_is_refused_and_nothing_is_kept(
    site: Site, alice: Account, units: sessionmaker[Session], name: str, content: bytes
) -> None:
    track_id = _failed_part(site, alice)

    with pytest.raises(InvalidInputError):
        _store(site.manual, track_id, name, content)

    assert list(_downloads_folder(site).iterdir()) == []
    with units() as db:
        assert db.scalars(select(DownloadRow)).all() == []


def test_a_file_over_the_limit_stops_while_it_arrives_and_nothing_is_kept(
    site: Site, alice: Account, units: sessionmaker[Session], clock: FakeClock
) -> None:
    track_id = _failed_part(site, alice)
    content = _two_second_wav()
    limited = _with_limit(site, units, clock, len(content) - 1)

    with pytest.raises(TooLargeError):
        _store(limited, track_id, "night.wav", content)

    assert list(_downloads_folder(site).iterdir()) == []


def test_a_file_exactly_at_the_limit_is_kept(
    site: Site, alice: Account, units: sessionmaker[Session], clock: FakeClock
) -> None:
    track_id = _failed_part(site, alice)
    content = _two_second_wav()
    limited = _with_limit(site, units, clock, len(content))

    _store(limited, track_id, "night.wav", content)

    assert [path.suffix for path in _downloads_folder(site).iterdir()] == [".wav"]


def test_an_upload_given_up_midway_leaves_no_file_behind(site: Site, alice: Account) -> None:
    track_id = _failed_part(site, alice)

    with site.manual.upload(track_id, "night.wav") as upload:
        upload.write(_two_second_wav()[:100])

    assert list(_downloads_folder(site).iterdir()) == []


def test_a_track_without_a_site_source_takes_no_file(site: Site) -> None:
    with pytest.raises(ConflictError):
        site.manual.upload(_library_track(site), "night.wav")


def test_a_track_that_does_not_exist_takes_no_file(site: Site) -> None:
    with pytest.raises(NotFoundError):
        site.manual.upload(TrackId(404), "night.wav")


def test_a_track_without_a_duration_takes_the_files(site: Site, alice: Account) -> None:
    added = site.links.add(
        alice, "https://www.bilibili.com/video/BVdown", "best", [PartChoice(1, "Night Drive", "")]
    )

    _store(site.manual, added[0].track_id, "night.wav", _two_second_wav())

    track = site.catalog.get_track(alice.id, added[0].track_id)
    assert track.details.duration_ms == 2000


def test_a_track_with_a_duration_keeps_it(
    site: Site, alice: Account, units: sessionmaker[Session]
) -> None:
    track_id = _failed_part(site, alice)
    with units() as db:
        known = db.get_one(TrackRow, track_id).duration_ms
    assert known == 1000

    _store(site.manual, track_id, "night.wav", _two_second_wav())

    assert site.catalog.get_track(alice.id, track_id).details.duration_ms == 1000


def test_adding_the_file_cancels_the_download_job_that_is_running(
    site: Site, alice: Account
) -> None:
    added = add_first_part(site, alice, "BVProxyProgress")
    assert added.job is not None
    site.wait_for(added.job.id, JobState.RUNNING)

    _store(site.manual, added.track_id, "night.wav", _two_second_wav())

    assert site.wait_for(added.job.id, JobState.CANCELLED).job.state is JobState.CANCELLED
    assert site.manual.state(added.track_id).status is DownloadStatus.DOWNLOADED


def test_adding_the_file_to_a_track_still_waiting_to_download_cancels_that_job(
    site: Site, alice: Account, units: sessionmaker[Session]
) -> None:
    track_id = _waiting_track(site, alice, units)
    waiting = site.jobs.active(DOWNLOAD_KIND, download_target(_source_of(units, track_id)))
    assert waiting is not None

    _store(site.manual, track_id, "night.wav", _two_second_wav())

    assert site.jobs.get_job(waiting.id).job.state is JobState.CANCELLED


def test_a_file_replaces_the_download_a_job_made_and_its_file(
    site: Site, alice: Account, units: sessionmaker[Session]
) -> None:
    track_id = _downloaded_part(site, alice)
    source_id = _source_of(units, track_id)
    assert (_downloads_folder(site) / f"{source_id}.m4a").is_file()

    _store(site.manual, track_id, "night.wav", _two_second_wav())

    assert [path.name for path in _downloads_folder(site).iterdir()] == [f"{source_id}.wav"]
    with units() as db:
        row = db.get_one(DownloadRow, source_id)
        assert (row.file_name, row.backend) == (f"{source_id}.wav", MANUAL_BACKEND)


def test_a_file_of_the_same_type_replaces_the_earlier_file_in_place(
    site: Site, alice: Account, units: sessionmaker[Session]
) -> None:
    track_id = _downloaded_part(site, alice)
    content = mp4_bytes(Mp4(header_seconds=3))

    _store(site.manual, track_id, "night.m4a", content)

    file = _downloads_folder(site) / f"{_source_of(units, track_id)}.m4a"
    assert [path.name for path in _downloads_folder(site).iterdir()] == [file.name]
    assert file.read_bytes() == content


def test_a_file_is_added_while_offline_since_nothing_contacts_the_site(
    site: Site, alice: Account, units: sessionmaker[Session]
) -> None:
    track_id = _failed_part(site, alice)
    site.online.online = False

    _store(site.manual, track_id, "night.wav", _two_second_wav())

    assert site.playback.play(alice, track_id) == Ready(_source_of(units, track_id), "audio/wav")


def test_adding_a_file_tells_what_changed_after_it_commits(site: Site, alice: Account) -> None:
    track_id = _failed_part(site, alice)
    site.changes.clear()

    _store(site.manual, track_id, "night.wav", _two_second_wav())

    assert site.changes == ["catalog"]


def test_the_sweep_at_startup_removes_a_file_a_crash_left_and_keeps_the_manual_download(
    site: Site, alice: Account, units: sessionmaker[Session]
) -> None:
    track_id = _failed_part(site, alice)
    _store(site.manual, track_id, "night.wav", _two_second_wav())
    left_behind = _downloads_folder(site) / ".upload-9f2c.wav"
    left_behind.write_bytes(b"half a file")

    site.downloads.sweep()

    assert [path.name for path in _downloads_folder(site).iterdir()] == [
        f"{_source_of(units, track_id)}.wav"
    ]


DAMAGEABLE = [
    wav_bytes(Song(seconds=2)),
    mp3_bytes(Song(seconds=2)),
    mp4_bytes(Mp4(header_seconds=2)),
]
"""Real audio files of three kinds, which the property below cuts short and fills with noise."""


@given(
    original=st.sampled_from(DAMAGEABLE),
    cut_at=st.integers(min_value=0, max_value=3000),
    noise=st.binary(max_size=64),
    noise_at=st.integers(min_value=0, max_value=3000),
    extension=st.sampled_from(sorted(MANUAL_EXTENSIONS)),
)
def test_a_damaged_file_under_any_accepted_extension_has_a_length_or_is_refused(
    original: bytes, cut_at: int, noise: bytes, noise_at: int, extension: str
) -> None:
    cut = original[:cut_at]
    damaged = cut[:noise_at] + noise + cut[noise_at:]
    with tempfile.TemporaryDirectory() as folder:
        file = Path(folder) / f"damaged.{extension}"
        file.write_bytes(damaged)

        try:
            length = audio_length_ms(file)
        except InvalidInputError:
            return

    assert length > 0
