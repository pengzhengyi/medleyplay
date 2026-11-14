"""The plugin `ffmpeg`: where a file's audio falls quiet, found with ffmpeg's `silencedetect`.

It runs the `ffmpeg` program installed on the server, which reads the whole file:
about three seconds for an hour of audio. Without the program it says so, rather
than failing, so the songs editor can say what snapping needs.
"""

import os
import re
import shutil
import subprocess  # nosec B404 -- runs only the ffmpeg program, never a shell
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Final

from medleyplay.plugin_api import (
    MAX_SILENCES,
    SILENCE_FINDER,
    FindSilences,
    FoundSilences,
    Plugin,
    Registry,
    Silence,
    SilenceStatus,
)

NOISE: Final = "-40dB"
"""How quiet the audio must be to count as silence."""
LEAST_SILENCE: Final = 0.5
"""The least length of a silence, in seconds: shorter dips inside a song don't count."""
TIMEOUT: Final = 240.0
"""The longest the program may take, in seconds: hours of audio take well under a minute."""
_START: Final = re.compile(r"silence_start: (-?[\d.]+)")
_END: Final = re.compile(r"silence_end: (-?[\d.]+)")

type Run = Callable[[Sequence[str]], subprocess.CompletedProcess[str]]
type Which = Callable[[str], str | None]


def _run(args: Sequence[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(  # noqa: S603  # nosec B603 -- ffmpeg from the path, fixed arguments
        args,
        capture_output=True,
        text=True,
        timeout=TIMEOUT,
        check=False,
        env={**os.environ, "LC_ALL": "C"},
    )


@dataclass(frozen=True)
class FfmpegSilences:
    """Finds a file's quiet stretches by running ffmpeg's `silencedetect` over it."""

    run: Run = _run
    which: Which = field(default=shutil.which)

    def find_silences(self, request: FindSilences) -> FoundSilences:
        """Return the file's quiet stretches, in order.

        A silence still going at the end of the file has no end, so it is left out.
        """
        program = self.which("ffmpeg")
        if program is None:
            return FoundSilences(status=SilenceStatus.NO_TOOL)
        done = self.run(
            [
                program,
                "-hide_banner",
                "-nostats",
                "-nostdin",
                "-i",
                _input_of(request),
                "-vn",
                "-af",
                f"silencedetect=noise={NOISE}:d={LEAST_SILENCE}",
                "-f",
                "null",
                "-",
            ]
        )
        if done.returncode != 0:
            return FoundSilences(status=SilenceStatus.UNREADABLE)
        return FoundSilences(silences=silences_in(done.stderr))


def silences_in(log: str) -> tuple[Silence, ...]:
    """Return the silences `silencedetect` logged, each a start then its end, in order."""
    found: list[Silence] = []
    start: float | None = None
    for line in log.splitlines():
        if (began := _START.search(line)) is not None:
            start = max(float(began.group(1)), 0.0)
        elif (ended := _END.search(line)) is not None and start is not None:
            end = max(float(ended.group(1)), start)
            found.append(Silence(start_ms=round(start * 1000), end_ms=round(end * 1000)))
            start = None
    return tuple(found[:MAX_SILENCES])


def _input_of(request: FindSilences) -> str:
    """Name the bytes to read: the file, or the slice of it a zip archive stores a member in."""
    if request.offset == 0 and request.length is None:
        return request.local_path
    end = "" if request.length is None else f"end,{request.offset + request.length},"
    return f"subfile,,start,{request.offset},{end},:{request.local_path}"


def register(registry: Registry) -> None:
    """Add the silence finder `ffmpeg`."""
    registry.add(SILENCE_FINDER, "ffmpeg", FfmpegSilences())


plugin = Plugin(api_version=1, register=register)
