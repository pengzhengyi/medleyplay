"""Finding where a Track's audio falls quiet with ffmpeg, in a real Job, and keeping it."""

import shutil
from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.accounts import AccountService
from medleyplay.application.segments import SongsService
from medleyplay.application.silences import FIND_SILENCES_KIND, SilenceService
from medleyplay.domain.accounts import Account
from medleyplay.domain.catalog import TrackId
from medleyplay.domain.errors import ConflictError, InvalidInputError
from medleyplay.domain.jobs import JobState
from medleyplay.domain.libraries import LibraryKind
from medleyplay.domain.segments import SongRow
from medleyplay.domain.silences import Silences, SilenceState
from medleyplay.domain.video_text import Song as ListedSong
from medleyplay.persistence.schema import SourceRow, TrackRow
from tests.support.audio import Song, folder_of
from tests.support.factories import NewAccountFactory
from tests.support.fakes import FakeClock
from tests.support.libraries import Libraries, running_libraries

needs_ffmpeg = pytest.mark.skipif(
    shutil.which("ffmpeg") is None, reason="needs the ffmpeg program installed"
)

BREMEN = Song("Bremen", songs_in_it=(2.0, 2.0))
"""A whole album in one file, five seconds long: a two-second song, a second of
silence, and another two-second song."""


@pytest.fixture
def alice(accounts: AccountService) -> Account:
    return accounts.create_first_admin(NewAccountFactory.admin()).account


@pytest.fixture
def running(units: sessionmaker[Session], clock: FakeClock, tmp_path: Path) -> Iterator[Libraries]:
    with running_libraries(units, clock, tmp_path / "data") as libraries:
        yield libraries


def _album(running: Libraries, alice: Account, units: sessionmaker[Session], root: Path) -> TrackId:
    """Scan a Library holding *Bremen.wav*, and return its Track."""
    registered = running.service.register(
        alice, "Music", LibraryKind.FOLDER, str(folder_of(root, {"Bremen.wav": BREMEN}))
    )
    assert registered.scan is not None
    running.wait_for(registered.scan.id, JobState.SUCCEEDED)
    with units() as db:
        return TrackId(db.scalars(select(SourceRow.track_id)).one())


def _found(running: Libraries, alice: Account, track_id: TrackId) -> Silences:
    """Find the Track's silences, and wait until the Job has."""
    running.silences.find(alice, track_id)
    [job] = [view.job for view in running.jobs.list_jobs() if view.job.kind == FIND_SILENCES_KIND]
    running.wait_for(job.id, JobState.SUCCEEDED)
    return running.silences.silences(track_id)


@needs_ffmpeg
def test_the_gap_between_an_albums_songs_is_found_and_kept(
    running: Libraries, alice: Account, units: sessionmaker[Session], tmp_path: Path
) -> None:
    track_id = _album(running, alice, units, tmp_path / "M")

    found = _found(running, alice, track_id)

    assert found.state is SilenceState.FOUND
    [gap] = found.silences
    assert 1_900 <= gap.start_ms <= 2_100
    assert 2_900 <= gap.end_ms <= 3_100


def test_a_track_never_asked_about_has_no_silences_known(
    running: Libraries, alice: Account, units: sessionmaker[Session], tmp_path: Path
) -> None:
    track_id = _album(running, alice, units, tmp_path / "M")

    assert running.silences.silences(track_id) == Silences(SilenceState.NOT_FOUND)


@needs_ffmpeg
def test_silences_found_before_the_file_changed_length_are_asked_for_again(
    running: Libraries, alice: Account, units: sessionmaker[Session], tmp_path: Path
) -> None:
    track_id = _album(running, alice, units, tmp_path / "M")
    _found(running, alice, track_id)

    with units.begin() as db:
        track = db.get(TrackRow, track_id)
        assert track is not None
        track.duration_ms = 9_000

    assert running.silences.silences(track_id) == Silences(SilenceState.NOT_FOUND)


def test_without_ffmpeg_installed_the_track_says_so(
    units: sessionmaker[Session],
    clock: FakeClock,
    tmp_path: Path,
    alice: Account,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    empty = tmp_path / "bin"
    empty.mkdir()
    monkeypatch.setenv("PATH", str(empty))
    with running_libraries(units, clock, tmp_path / "data") as running:
        track_id = _album(running, alice, units, tmp_path / "M")

        found = _found(running, alice, track_id)

    assert found == Silences(SilenceState.NO_TOOL)


def test_the_gaps_are_found_in_the_whole_file_not_one_of_its_songs(
    running: Libraries,
    alice: Account,
    units: sessionmaker[Session],
    songs: SongsService,
    tmp_path: Path,
) -> None:
    album = _album(running, alice, units, tmp_path / "M")
    view = songs.save(
        album,
        [SongRow(None, ListedSong(0, "アイネクライネ")), SongRow(None, ListedSong(3_000, "Last"))],
    )

    with pytest.raises(InvalidInputError, match="whole file"):
        running.silences.find(alice, view.songs[1].track_id)


def test_finding_them_needs_the_ffmpeg_plugin_on(silences: SilenceService, alice: Account) -> None:
    with pytest.raises(ConflictError, match="ffmpeg plugin"):
        silences.find(alice, TrackId(1))
