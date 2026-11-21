"""The plugin `ffmpeg-thumbnails`: smaller copies of a kept image, made with ffmpeg.

It runs the `ffprobe` and `ffmpeg` programs installed on the server. `ffprobe` reads
the image's size and pixel format, then one `ffmpeg` run decodes it once and writes
each size it is larger than: about a tenth of a second for a 1,728-pixel cover.
Without the programs it says so, rather than failing.

The images come from uploads, scans, and sites, so ffmpeg reads each only as the
kind its bytes say, and refuses one larger than 40 megapixels.
"""

import json
import os
import shutil
import subprocess  # nosec B404 -- runs only ffprobe and ffmpeg, never a shell
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Final

from medleyplay.plugin_api import (
    THUMBNAILER,
    ImageKind,
    MadeThumbnails,
    MakeThumbnails,
    Plugin,
    Registry,
    ThumbnailSize,
    ThumbnailStatus,
)

TIMEOUT: Final = 20.0
"""The longest either program may take, in seconds: a cover takes well under one."""
MAX_PIXELS: Final = 40_000_000
"""The most pixels an image may have; a larger one is unreadable."""
LONGEST: Final = 4
"""How many times its size a thumbnail's longer side may be; a banner is cut to it."""

_DEMUXERS: Final = {
    ImageKind.JPEG: "jpeg_pipe",
    ImageKind.PNG: "png_pipe",
    ImageKind.WEBP: "webp_pipe",
}
"""How ffmpeg reads each kind: never guessed, so it can't be led to another format."""
_WITH_ALPHA: Final = frozenset(
    {
        "argb",
        "abgr",
        "bgra",
        "rgba",
        "rgba64be",
        "rgba64le",
        "ya8",
        "ya16be",
        "ya16le",
        "yuva420p",
        "yuva444p",
        "pal8",
    }
)
"""The pixel formats that may hold transparency; a palette may mark a color clear."""

type Run = Callable[[Sequence[str]], subprocess.CompletedProcess[str]]
type Which = Callable[[str], str | None]


def _run(args: Sequence[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(  # noqa: S603  # nosec B603 -- ffprobe or ffmpeg from the path, fixed arguments
        args,
        capture_output=True,
        text=True,
        timeout=TIMEOUT,
        check=False,
        stdin=subprocess.DEVNULL,
        env={**os.environ, "LC_ALL": "C"},
    )


@dataclass(frozen=True)
class _Picture:
    width: int
    height: int
    pix_fmt: str


@dataclass(frozen=True)
class FfmpegThumbnails:
    """Makes a kept image's thumbnails by running ffprobe, then ffmpeg once."""

    run: Run = _run
    which: Which = field(default=shutil.which)

    def make_thumbnails(self, request: MakeThumbnails) -> MadeThumbnails:
        """Write a thumbnail for each size the image's shorter side is longer than.

        An image no larger than any size needs none, and gets none.
        """
        ffprobe, ffmpeg = self.which("ffprobe"), self.which("ffmpeg")
        if ffprobe is None or ffmpeg is None:
            return MadeThumbnails(status=ThumbnailStatus.NO_TOOL)
        try:
            picture = self._probe(ffprobe, request)
            if picture is None or picture.width * picture.height > MAX_PIXELS:
                return MadeThumbnails(status=ThumbnailStatus.UNREADABLE)
            shorter = min(picture.width, picture.height)
            sizes = tuple(size for size in request.sizes if shorter > size.pixels)
            if not sizes:
                return MadeThumbnails()
            png = request.kind is not ImageKind.JPEG and picture.pix_fmt in _WITH_ALPHA
            done = self.run(_scale(ffmpeg, request, sizes, png=png))
        except subprocess.TimeoutExpired:
            return MadeThumbnails(status=ThumbnailStatus.TIMED_OUT)
        if done.returncode != 0:
            return MadeThumbnails(status=ThumbnailStatus.UNREADABLE)
        return MadeThumbnails(made=tuple(size.label for size in sizes))

    def _probe(self, ffprobe: str, request: MakeThumbnails) -> _Picture | None:
        done = self.run(
            [
                ffprobe,
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=width,height,pix_fmt",
                "-of",
                "json",
                "-f",
                _DEMUXERS[request.kind],
                "-i",
                request.source_path,
            ]
        )
        if done.returncode != 0:
            return None
        try:
            [stream] = json.loads(done.stdout)["streams"]
            return _Picture(int(stream["width"]), int(stream["height"]), str(stream["pix_fmt"]))
        except (ValueError, KeyError, TypeError):
            return None


def _scale(
    ffmpeg: str, request: MakeThumbnails, sizes: Sequence[ThumbnailSize], *, png: bool
) -> list[str]:
    """Return ffmpeg's arguments: decode once, then scale and write each size."""
    split = f"[0:v]split={len(sizes)}" + "".join(f"[in{i}]" for i in range(len(sizes)))
    scales = [
        f"[in{i}]scale=w={size.pixels}:h={size.pixels}:force_original_aspect_ratio=increase"
        f":flags=lanczos,crop=w=min(iw\\,{size.pixels * LONGEST})"
        f":h=min(ih\\,{size.pixels * LONGEST})[out{i}]"
        for i, size in enumerate(sizes)
    ]
    codec = ["-c:v", "png"] if png else ["-c:v", "mjpeg", "-q:v", str(request.quality)]
    args = [
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        "-threads",
        "1",
        "-max_pixels",
        str(MAX_PIXELS),
        "-f",
        _DEMUXERS[request.kind],
        "-i",
        request.source_path,
        "-filter_complex",
        ";".join([split, *scales]),
    ]
    for i, size in enumerate(sizes):
        args += [
            "-map",
            f"[out{i}]",
            "-frames:v",
            "1",
            "-an",
            "-sn",
            "-dn",
            *codec,
            "-f",
            "image2",
            "-update",
            "1",
            os.path.join(request.folder, f"{request.name}-{size.label}"),  # noqa: PTH118 -- a path string for the program
        ]
    return args


def register(registry: Registry) -> None:
    """Add the thumbnailer `ffmpeg-thumbnails`."""
    registry.add(THUMBNAILER, "ffmpeg-thumbnails", FfmpegThumbnails())


plugin = Plugin(api_version=1, register=register)
