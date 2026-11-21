"""The thumbnailer: smaller copies of a kept image, made by ffmpeg."""

import json
import shutil
import subprocess
from collections.abc import Sequence
from pathlib import Path

import pytest

from medleyplay.plugin_api import (
    ImageKind,
    MadeThumbnails,
    MakeThumbnails,
    ThumbnailSize,
    ThumbnailStatus,
)
from medleyplay.plugins.ffmpeg_thumbnails import FfmpegThumbnails

NAME = "3f9a" * 16
SMALL = ThumbnailSize(label="small", pixels=128)
MEDIUM = ThumbnailSize(label="medium", pixels=512)
PICTURES = Path(__file__).parents[2] / "support" / "pictures"
FFMPEG = shutil.which("ffmpeg")
needs_ffmpeg = pytest.mark.skipif(
    FFMPEG is None or shutil.which("ffprobe") is None,
    reason="needs the ffmpeg and ffprobe programs installed",
)


class FakePrograms:
    """Stands for `ffprobe` and `ffmpeg`: probes as an image of `width` by `height` in `pix_fmt`.

    Keeps each call's arguments; `ffmpeg_code` is what ffmpeg exits with, and
    `timeout` makes ffmpeg take too long.
    """

    def __init__(
        self,
        width: int = 1728,
        height: int = 1728,
        pix_fmt: str = "yuvj420p",
        *,
        ffmpeg_code: int = 0,
        timeout: bool = False,
    ) -> None:
        self.probed = {"streams": [{"width": width, "height": height, "pix_fmt": pix_fmt}]}
        self.ffmpeg_code, self.timeout = ffmpeg_code, timeout
        self.calls: list[list[str]] = []

    @property
    def ffmpeg(self) -> list[str]:
        """The arguments ffmpeg was run with."""
        [args] = [each for each in self.calls if each[0].endswith("/ffmpeg")]
        return args

    def __call__(self, args: Sequence[str]) -> subprocess.CompletedProcess[str]:
        self.calls.append(list(args))
        if args[0].endswith("/ffprobe"):
            return subprocess.CompletedProcess(args, 0, json.dumps(self.probed), "")
        if self.timeout:
            raise subprocess.TimeoutExpired(args, 20)
        return subprocess.CompletedProcess(args, self.ffmpeg_code, "", "")


def thumbnailer_over(programs: FakePrograms) -> FfmpegThumbnails:
    """The thumbnailer, running `programs` in place of ffprobe and ffmpeg."""
    return FfmpegThumbnails(run=programs, which=lambda program: f"/usr/bin/{program}")


def asked(
    source: Path | str = "/data/covers/x",
    kind: ImageKind = ImageKind.JPEG,
    *,
    folder: Path | str = "/data/jobs/41",
) -> MakeThumbnails:
    """Ask for the small and medium thumbnails of the image `source`, written into `folder`."""
    return MakeThumbnails(
        source_path=str(source),
        kind=kind,
        name=NAME,
        folder=str(folder),
        sizes=(SMALL, MEDIUM),
        quality=4,
    )


def test_a_large_image_gets_a_thumbnail_of_each_size() -> None:
    made = thumbnailer_over(FakePrograms()).make_thumbnails(asked())

    assert made == MadeThumbnails(made=("small", "medium"))


def test_each_thumbnail_is_named_by_the_image_and_its_size_in_the_folder() -> None:
    programs = FakePrograms()

    thumbnailer_over(programs).make_thumbnails(asked())

    assert f"/data/jobs/41/{NAME}-small" in programs.ffmpeg
    assert f"/data/jobs/41/{NAME}-medium" in programs.ffmpeg


def test_the_input_is_read_as_the_kind_its_bytes_say() -> None:
    programs = FakePrograms()

    thumbnailer_over(programs).make_thumbnails(asked(kind=ImageKind.WEBP))

    for each in programs.calls:
        assert each[each.index("-i") - 2 : each.index("-i") + 2] == [
            "-f",
            "webp_pipe",
            "-i",
            "/data/covers/x",
        ]


def test_ffmpeg_runs_bounded_on_one_thread_without_stdin() -> None:
    programs = FakePrograms()

    thumbnailer_over(programs).make_thumbnails(asked())

    args = programs.ffmpeg
    assert args[args.index("-max_pixels") + 1] == "40000000"
    assert args[args.index("-threads") + 1] == "1"
    assert "-nostdin" in args
    assert args.count("-frames:v") == 2
    assert args.count("-an") == 2


def test_a_size_the_image_is_no_larger_than_is_left_out() -> None:
    programs = FakePrograms(width=500, height=800)

    made = thumbnailer_over(programs).make_thumbnails(asked())

    assert made == MadeThumbnails(made=("small",))
    assert f"/data/jobs/41/{NAME}-medium" not in programs.ffmpeg


def test_an_image_no_larger_than_any_size_needs_no_thumbnail_and_no_ffmpeg() -> None:
    programs = FakePrograms(width=128, height=300)

    made = thumbnailer_over(programs).make_thumbnails(asked())

    assert made == MadeThumbnails()
    assert [each[0] for each in programs.calls] == ["/usr/bin/ffprobe"]


def test_an_image_with_transparency_gets_png_thumbnails() -> None:
    programs = FakePrograms(pix_fmt="rgba")

    thumbnailer_over(programs).make_thumbnails(asked(kind=ImageKind.PNG))

    args = programs.ffmpeg
    assert [args[i + 1] for i, each in enumerate(args) if each == "-c:v"] == ["png", "png"]


def test_an_image_without_transparency_gets_jpeg_thumbnails_at_the_quality_asked() -> None:
    programs = FakePrograms(pix_fmt="rgb24")

    thumbnailer_over(programs).make_thumbnails(asked(kind=ImageKind.PNG))

    args = programs.ffmpeg
    assert [args[i + 1] for i, each in enumerate(args) if each == "-c:v"] == ["mjpeg", "mjpeg"]
    assert [args[i + 1] for i, each in enumerate(args) if each == "-q:v"] == ["4", "4"]


def test_an_image_over_forty_megapixels_is_unreadable_without_running_ffmpeg() -> None:
    programs = FakePrograms(width=8000, height=6000)

    made = thumbnailer_over(programs).make_thumbnails(asked())

    assert made == MadeThumbnails(status=ThumbnailStatus.UNREADABLE)
    assert [each[0] for each in programs.calls] == ["/usr/bin/ffprobe"]


@pytest.mark.parametrize("missing", ["ffmpeg", "ffprobe"])
def test_without_ffmpeg_or_ffprobe_installed_it_says_so(missing: str) -> None:
    def which(program: str) -> str | None:
        return None if program == missing else f"/usr/bin/{program}"

    thumbnailer = FfmpegThumbnails(run=FakePrograms(), which=which)

    made = thumbnailer.make_thumbnails(asked())

    assert made == MadeThumbnails(status=ThumbnailStatus.NO_TOOL)


def test_a_file_ffprobe_finds_no_picture_in_is_unreadable() -> None:
    programs = FakePrograms()
    programs.probed = {"streams": []}

    made = thumbnailer_over(programs).make_thumbnails(asked())

    assert made == MadeThumbnails(status=ThumbnailStatus.UNREADABLE)


def test_a_file_ffmpeg_fails_on_is_unreadable() -> None:
    made = thumbnailer_over(FakePrograms(ffmpeg_code=69)).make_thumbnails(asked())

    assert made == MadeThumbnails(status=ThumbnailStatus.UNREADABLE)


def test_ffmpeg_taking_too_long_says_it_timed_out() -> None:
    made = thumbnailer_over(FakePrograms(timeout=True)).make_thumbnails(asked())

    assert made == MadeThumbnails(status=ThumbnailStatus.TIMED_OUT)


def make_image(path: Path, source: str, *output: str) -> Path:
    """Write the first frame of the ffmpeg source `source` to `path`, with `output` options."""
    subprocess.run(  # noqa: S603 -- ffmpeg, making the test's own image
        [
            str(FFMPEG),
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            source,
            "-frames:v",
            "1",
            *output,
            str(path),
        ],
        check=True,
    )
    return path


def probe(path: Path) -> tuple[int, int, str]:
    """Return the width, height, and codec of the picture in `path`."""
    shown = subprocess.run(  # noqa: S603 -- ffprobe, reading the test's own image
        [
            str(shutil.which("ffprobe")),
            "-v",
            "error",
            "-show_entries",
            "stream=width,height,codec_name",
            "-of",
            "json",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    [stream] = json.loads(shown.stdout)["streams"]
    return stream["width"], stream["height"], stream["codec_name"]


@needs_ffmpeg
def test_the_real_programs_scale_the_shorter_side_and_keep_the_aspect(tmp_path: Path) -> None:
    image = make_image(tmp_path / "wide.jpg", "testsrc=size=1500x1000")

    made = FfmpegThumbnails().make_thumbnails(asked(image, folder=tmp_path))

    assert made == MadeThumbnails(made=("small", "medium"))
    assert probe(tmp_path / f"{NAME}-small") == (192, 128, "mjpeg")
    assert probe(tmp_path / f"{NAME}-medium") == (768, 512, "mjpeg")


@needs_ffmpeg
def test_the_real_programs_cut_a_banner_to_four_times_the_size(tmp_path: Path) -> None:
    image = make_image(tmp_path / "banner.png", "testsrc=size=3000x200", "-pix_fmt", "rgb24")

    FfmpegThumbnails().make_thumbnails(asked(image, ImageKind.PNG, folder=tmp_path))

    assert probe(tmp_path / f"{NAME}-small") == (512, 128, "mjpeg")


@needs_ffmpeg
def test_the_real_programs_keep_the_transparency_of_a_png(tmp_path: Path) -> None:
    image = make_image(tmp_path / "clear.png", "color=c=red@0.5:s=600x600,format=rgba")

    made = FfmpegThumbnails().make_thumbnails(asked(image, ImageKind.PNG, folder=tmp_path))

    assert made == MadeThumbnails(made=("small", "medium"))
    assert probe(tmp_path / f"{NAME}-small") == (128, 128, "png")


@needs_ffmpeg
def test_the_real_programs_read_a_webp_with_transparency(tmp_path: Path) -> None:
    image = PICTURES / "translucent.webp"

    made = FfmpegThumbnails().make_thumbnails(asked(image, ImageKind.WEBP, folder=tmp_path))

    assert made == MadeThumbnails(made=("small",))
    assert probe(tmp_path / f"{NAME}-small") == (192, 128, "png")


@needs_ffmpeg
def test_the_real_programs_find_an_animated_webp_unreadable(tmp_path: Path) -> None:
    made = FfmpegThumbnails().make_thumbnails(
        asked(PICTURES / "animated.webp", ImageKind.WEBP, folder=tmp_path)
    )

    assert made == MadeThumbnails(status=ThumbnailStatus.UNREADABLE)


@needs_ffmpeg
def test_the_real_programs_turn_a_jpeg_by_its_exif_orientation(tmp_path: Path) -> None:
    upright = make_image(tmp_path / "upright.jpg", "testsrc=size=600x300")
    turned = tmp_path / "turned.jpg"
    turned.write_bytes(with_orientation(upright.read_bytes(), 6))

    FfmpegThumbnails().make_thumbnails(asked(turned, folder=tmp_path))

    assert probe(tmp_path / f"{NAME}-small") == (128, 256, "mjpeg")


@needs_ffmpeg
def test_the_real_programs_read_a_cmyk_jpeg(tmp_path: Path) -> None:
    image = tmp_path / "print.jpg"
    image.write_bytes((PICTURES / "cmyk.jpg").read_bytes())

    made = FfmpegThumbnails().make_thumbnails(asked(image, folder=tmp_path))

    assert made.status is ThumbnailStatus.OK
    assert probe(tmp_path / f"{NAME}-small")[2] == "mjpeg"


def with_orientation(jpeg: bytes, orientation: int) -> bytes:
    """Return `jpeg` with an EXIF block saying how to turn it, as a phone camera writes.

    Orientation 6 means the picture is shown turned a quarter clockwise.
    """
    tiff = (
        b"MM\x00\x2a\x00\x00\x00\x08\x00\x01"  # a big-endian header, then one entry:
        b"\x01\x12\x00\x03\x00\x00\x00\x01"  # Orientation, one short
        + orientation.to_bytes(2, "big")
        + b"\x00\x00\x00\x00\x00\x00"
    )
    block = b"Exif\x00\x00" + tiff
    return jpeg[:2] + b"\xff\xe1" + (len(block) + 2).to_bytes(2, "big") + block + jpeg[2:]
