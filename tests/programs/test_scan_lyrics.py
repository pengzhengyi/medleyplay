"""The scan program and the `.lrc` beside an audio file: which it reads, and how."""

from pathlib import Path

from medleyplay.plugin_api import MAX_LYRICS
from tests.support.audio import Song, folder_of
from tests.support.scans import known_after, scan_files

MELT = """\
[ti:メルト]
[00:12.34]朝目が覚めて
[00:15.50]真っ先に思い浮かぶ
"""
WORLD_IS_MINE = """\
[00:10.00]世界で一番おひめさま
"""


def _lyrics_beside(audio: Path, text: str, encoding: str = "utf-8") -> Path:
    """Write `text` as the `.lrc` beside `audio`, named as it is, in `encoding`."""
    lrc = audio.with_suffix(".lrc")
    lrc.write_bytes(text.encode(encoding))
    return lrc


def test_an_lrc_beside_its_audio_is_read_and_is_not_a_file_of_its_own(tmp_path: Path) -> None:
    music = folder_of(tmp_path / "Music", {"Blue/melt.wav": Song("Melt")})
    lrc = _lyrics_beside(music / "Blue" / "melt.wav", MELT)

    found = scan_files(tmp_path, music)

    lyrics = found["Blue/melt.wav"].lyrics_file
    assert list(found) == ["Blue/melt.wav"]
    assert lyrics is not None
    assert (lyrics.size, lyrics.modified_ns) == (lrc.stat().st_size, lrc.stat().st_mtime_ns)
    assert (lyrics.text, lyrics.error) == (MELT, "")


def test_an_lrc_written_in_gbk_or_with_a_byte_order_mark_is_read(tmp_path: Path) -> None:
    music = folder_of(tmp_path / "Music", {"a.wav": Song("A"), "b.wav": Song("B")})
    _lyrics_beside(music / "a.wav", "[00:01.00]晴天\n", "gbk")
    _lyrics_beside(music / "b.wav", "[00:01.00]晴天\n", "utf-8-sig")

    found = scan_files(tmp_path, music)

    assert [file.lyrics_file and file.lyrics_file.text for file in found.values()] == [
        "[00:01.00]晴天\n",
        "[00:01.00]晴天\n",
    ]


def test_an_lrc_named_in_capitals_is_read_and_one_with_no_audio_is_ignored(
    tmp_path: Path,
) -> None:
    music = folder_of(tmp_path / "Music", {"a.wav": Song("A"), "b.wav": Song("B")})
    (music / "a.LRC").write_text(MELT, encoding="utf-8")
    (music / "orphan.lrc").write_text(MELT, encoding="utf-8")

    found = scan_files(tmp_path, music)

    assert list(found) == ["a.wav", "b.wav"]
    assert found["a.wav"].lyrics_file is not None
    assert found["b.wav"].lyrics_file is None


def test_an_unchanged_lrc_is_listed_with_its_stamp_but_read_only_by_a_full_scan(
    tmp_path: Path,
) -> None:
    music = folder_of(tmp_path / "Music", {"a.wav": Song("A")})
    _lyrics_beside(music / "a.wav", MELT)
    known = known_after(scan_files(tmp_path, music))

    again = scan_files(tmp_path, music, known=known)["a.wav"].lyrics_file
    full = scan_files(tmp_path, music, known=known, full=True)["a.wav"].lyrics_file

    assert again is not None
    assert (again.text, again.error) == (None, "")
    assert full is not None
    assert full.text == MELT


def test_a_changed_lrc_is_read_again_while_the_unchanged_audio_is_not(tmp_path: Path) -> None:
    music = folder_of(tmp_path / "Music", {"a.wav": Song("A")})
    _lyrics_beside(music / "a.wav", MELT)
    known = known_after(scan_files(tmp_path, music))

    _lyrics_beside(music / "a.wav", WORLD_IS_MINE)
    found = scan_files(tmp_path, music, known=known)["a.wav"]

    assert found.tags is None
    assert found.lyrics_file is not None
    assert found.lyrics_file.text == WORLD_IS_MINE


def test_an_lrc_that_cant_be_read_is_a_noted_error_and_the_scan_goes_on(tmp_path: Path) -> None:
    music = folder_of(tmp_path / "Music", {"a.wav": Song("A"), "b.wav": Song("B")})
    (music / "a.lrc").write_bytes(b"\x80\x81\xff")
    _lyrics_beside(music / "b.wav", "[00:01.00]" + "la " * MAX_LYRICS)

    found = scan_files(tmp_path, music)

    errors = [file.lyrics_file and file.lyrics_file.error for file in found.values()]
    assert errors == ["isn't text", "is too long"]
    assert [file.lyrics_file and file.lyrics_file.text for file in found.values()] == [None, None]
    assert found["a.wav"].tags is not None
