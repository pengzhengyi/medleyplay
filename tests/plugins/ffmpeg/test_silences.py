"""The silence finder: the quiet stretches ffmpeg's `silencedetect` finds in a file."""

import shutil
import subprocess
from collections.abc import Sequence
from pathlib import Path

import pytest

from medleyplay.plugin_api import FindSilences, Silence, SilenceStatus
from medleyplay.plugins.ffmpeg import FfmpegSilences, silences_in
from tests.support.recordings import RECORDINGS

BAD = (RECORDINGS / "silencedetect.txt").read_text(encoding="utf-8")
"""What `silencedetect` logged for a 48-minute upload of Michael Jackson's *Bad*."""


class FakeFfmpeg:
    """Stands for the `ffmpeg` program: answers with `log` and `returncode`, and keeps the call."""

    def __init__(self, log: str = BAD, returncode: int = 0) -> None:
        self.log, self.returncode = log, returncode
        self.args: list[str] = []

    def __call__(self, args: Sequence[str]) -> subprocess.CompletedProcess[str]:
        self.args = list(args)
        return subprocess.CompletedProcess(args, self.returncode, "", self.log)


def finder_over(ffmpeg: FakeFfmpeg) -> FfmpegSilences:
    """The finder, running `ffmpeg` in place of the program."""
    return FfmpegSilences(run=ffmpeg, which=lambda _: "/usr/bin/ffmpeg")


def test_the_gaps_between_an_albums_songs_are_found_in_order() -> None:
    found = finder_over(FakeFfmpeg()).find_silences(FindSilences(local_path="/m/Bad.m4a"))

    assert found.status is SilenceStatus.OK
    assert found.silences[:3] == (
        Silence(start_ms=0, end_ms=656),
        Silence(start_ms=246_307, end_ms=247_672),
        Silence(start_ms=542_241, end_ms=542_763),
    )
    assert len(found.silences) == 13


def test_the_whole_file_is_read_for_silences_of_half_a_second_or_more() -> None:
    ffmpeg = FakeFfmpeg()

    finder_over(ffmpeg).find_silences(FindSilences(local_path="/m/Bad.m4a"))

    assert ffmpeg.args[ffmpeg.args.index("-i") + 1] == "/m/Bad.m4a"
    assert "silencedetect=noise=-40dB:d=0.5" in ffmpeg.args


def test_a_member_stored_in_a_zip_archive_is_read_as_its_slice() -> None:
    ffmpeg = FakeFfmpeg()

    finder_over(ffmpeg).find_silences(
        FindSilences(local_path="/m/Albums.zip", offset=1_000, length=5_000)
    )

    assert ffmpeg.args[ffmpeg.args.index("-i") + 1] == (
        "subfile,,start,1000,end,6000,,:/m/Albums.zip"
    )


def test_a_silence_still_going_at_the_end_of_the_file_is_left_out() -> None:
    log = """
    [Parsed_silencedetect_0 @ 0x1] silence_start: 12.5
    [Parsed_silencedetect_0 @ 0x1] silence_end: 14 | silence_duration: 1.5
    [Parsed_silencedetect_0 @ 0x1] silence_start: 300.25
    """

    assert silences_in(log) == (Silence(start_ms=12_500, end_ms=14_000),)


def test_without_ffmpeg_installed_it_says_so() -> None:
    finder = FfmpegSilences(run=FakeFfmpeg(), which=lambda _: None)

    found = finder.find_silences(FindSilences(local_path="/m/Bad.m4a"))

    assert (found.status, found.silences) == (SilenceStatus.NO_TOOL, ())


def test_a_file_ffmpeg_cannot_read_has_no_silences() -> None:
    ffmpeg = FakeFfmpeg(log="/m/notes.txt: Invalid data found when processing input", returncode=1)

    found = finder_over(ffmpeg).find_silences(FindSilences(local_path="/m/notes.txt"))

    assert (found.status, found.silences) == (SilenceStatus.UNREADABLE, ())


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="needs the ffmpeg program installed")
def test_the_real_program_finds_the_gap_between_two_tones(tmp_path: Path) -> None:
    tones = tmp_path / "tones.wav"
    two_tones_apart = (
        "sine=frequency=440:duration=2,apad=pad_dur=1.5[a];"
        "sine=frequency=660:duration=2[b];[a][b]concat=n=2:v=0:a=1"
    )
    subprocess.run(  # noqa: S603 -- ffmpeg, making the test's own file
        [
            str(shutil.which("ffmpeg")),
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            two_tones_apart,
            str(tones),
        ],
        check=True,
    )

    found = FfmpegSilences().find_silences(FindSilences(local_path=str(tones)))

    [gap] = found.silences
    assert 1_900 <= gap.start_ms <= 2_100
    assert 3_400 <= gap.end_ms <= 3_600
