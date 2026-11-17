"""Lyrics a scan finds in a song's files: its tags, and the `.lrc` beside it, kept apart."""

from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.accounts import AccountService
from medleyplay.application.lyrics import shown_lyrics
from medleyplay.domain.accounts import Account
from medleyplay.domain.catalog import TrackId
from medleyplay.domain.jobs import JobState
from medleyplay.domain.libraries import Library, LibraryKind
from medleyplay.domain.lyrics import Line, LyricsOrigin
from medleyplay.persistence.schema import SourceRow
from tests.support.audio import Song, mp3_bytes
from tests.support.factories import NewAccountFactory
from tests.support.fakes import FakeClock
from tests.support.libraries import Libraries, running_libraries

IN_TAGS = """\
[00:01.00]Melt, from the tags
"""
IN_LRC = """\
[00:02.00]Melt, from the .lrc
"""


@pytest.fixture
def alice(accounts: AccountService) -> Account:
    return accounts.create_first_admin(NewAccountFactory.admin()).account


@pytest.fixture
def libraries(
    units: sessionmaker[Session], clock: FakeClock, tmp_path: Path
) -> Iterator[Libraries]:
    with running_libraries(units, clock, tmp_path / "data") as running:
        yield running


def _melt(music: Path, *lyrics: str) -> Path:
    """Write `Melt.mp3`, whose tags hold each of `lyrics`, in `music`; return the file."""
    music.mkdir(parents=True, exist_ok=True)
    audio = music / "Melt.mp3"
    audio.write_bytes(mp3_bytes(Song("Melt", lyrics=lyrics)))
    return audio


def _scanned(libraries: Libraries, alice: Account, music: Path) -> Library:
    registered = libraries.service.register(alice, "Music", LibraryKind.FOLDER, str(music))
    assert registered.scan is not None
    libraries.wait_for(registered.scan.id, JobState.SUCCEEDED)
    return registered.library


def _rescan(libraries: Libraries, alice: Account, library: Library) -> None:
    libraries.wait_for(libraries.service.scan(alice, library.id).id, JobState.SUCCEEDED)


def _shown(units: sessionmaker[Session]) -> tuple[LyricsOrigin, tuple[Line, ...]] | None:
    """Return where the one song's lyrics shown came from, and their lines."""
    with units() as db:
        track_id = TrackId(db.scalars(select(SourceRow.track_id)).one())
        shown = shown_lyrics(db, track_id)
    return None if shown is None else (shown.origin, shown.lyrics.lines)


def test_the_lyrics_in_a_songs_tags_are_shown(
    libraries: Libraries, alice: Account, tmp_path: Path, units: sessionmaker[Session]
) -> None:
    _melt(tmp_path / "Music", IN_TAGS)

    _scanned(libraries, alice, tmp_path / "Music")

    assert _shown(units) == (LyricsOrigin.TAG, (Line(1_000, "Melt, from the tags"),))


def test_an_lrc_beside_a_song_shows_over_its_tags_and_removed_leaves_them(
    libraries: Libraries, alice: Account, tmp_path: Path, units: sessionmaker[Session]
) -> None:
    audio = _melt(tmp_path / "Music", IN_TAGS)
    audio.with_suffix(".lrc").write_text(IN_LRC, encoding="utf-8")
    library = _scanned(libraries, alice, tmp_path / "Music")
    beside = _shown(units)

    audio.with_suffix(".lrc").unlink()
    _rescan(libraries, alice, library)

    assert beside == (LyricsOrigin.SIDECAR, (Line(2_000, "Melt, from the .lrc"),))
    assert _shown(units) == (LyricsOrigin.TAG, (Line(1_000, "Melt, from the tags"),))


def test_an_lrc_added_beside_a_known_song_is_read(
    libraries: Libraries, alice: Account, tmp_path: Path, units: sessionmaker[Session]
) -> None:
    audio = _melt(tmp_path / "Music")
    library = _scanned(libraries, alice, tmp_path / "Music")
    before = _shown(units)

    audio.with_suffix(".lrc").write_text(IN_LRC, encoding="utf-8")
    _rescan(libraries, alice, library)

    assert before is None
    assert _shown(units) == (LyricsOrigin.SIDECAR, (Line(2_000, "Melt, from the .lrc"),))


def test_lyrics_taken_out_of_a_songs_tags_are_no_longer_shown(
    libraries: Libraries, alice: Account, tmp_path: Path, units: sessionmaker[Session]
) -> None:
    audio = _melt(tmp_path / "Music", IN_TAGS)
    library = _scanned(libraries, alice, tmp_path / "Music")

    audio.write_bytes(mp3_bytes(Song("Melt", seconds=2)))
    _rescan(libraries, alice, library)

    assert _shown(units) is None


def test_an_lrc_that_cant_be_read_leaves_the_lyrics_read_before_and_says_why(
    libraries: Libraries, alice: Account, tmp_path: Path, units: sessionmaker[Session]
) -> None:
    audio = _melt(tmp_path / "Music")
    audio.with_suffix(".lrc").write_text(IN_LRC, encoding="utf-8")
    library = _scanned(libraries, alice, tmp_path / "Music")

    audio.with_suffix(".lrc").write_bytes(b"\x80\x81\xff")
    _rescan(libraries, alice, library)
    with units() as db:
        details = db.scalars(select(SourceRow)).one().details or {}

    assert _shown(units) == (LyricsOrigin.SIDECAR, (Line(2_000, "Melt, from the .lrc"),))
    assert details["lrc_error"] == "isn't text"
