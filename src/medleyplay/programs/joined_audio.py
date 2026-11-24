"""Join checked local audio in a Download Job."""

# cspell:ignore EFBIG FSIZE getrlimit RLIM RLIMIT setrlimit SIGXFSZ faststart xerror

import errno
import json
import math
import resource
import shutil
import signal
import subprocess  # nosec B404 -- fixed local audio programs, without a shell
from collections.abc import Callable, Iterator, Sequence
from contextlib import contextmanager
from pathlib import Path
from typing import IO, Final

from medleyplay.download_limits import JOIN_OUTPUT_KBPS
from medleyplay.plugin_host.job import AnswerFailedError

_CHANNELS: Final = 2
_SAMPLE_RATE: Final = 48000
_PCM: Final = ("-f", "f32le", "-ar", str(_SAMPLE_RATE), "-ac", str(_CHANNELS))
_TOOL_TIMEOUT: Final = 540


def join_tools() -> tuple[str, str] | None:
    """Find both local tools needed to encode and validate a joined album."""
    ffmpeg, ffprobe = shutil.which("ffmpeg"), shutil.which("ffprobe")
    return (ffmpeg, ffprobe) if ffmpeg is not None and ffprobe is not None else None


@contextmanager
def file_limit(bytes_left: int) -> Iterator[None]:
    """Limit a Job's next file and restore its previous process limits afterward."""
    if bytes_left <= 0:
        message = "The selected album parts exceed the temporary download limit."
        raise AnswerFailedError(message, kind="invalid")
    previous = resource.getrlimit(resource.RLIMIT_FSIZE)
    soft, hard = previous
    limit = bytes_left if soft == resource.RLIM_INFINITY else min(bytes_left, soft)
    # Report a blocked write as an error rather than terminating the Job process.
    handler = signal.signal(signal.SIGXFSZ, signal.SIG_IGN)
    try:
        resource.setrlimit(resource.RLIMIT_FSIZE, (limit, hard))
        yield
    except OSError as error:
        if error.errno != errno.EFBIG:
            raise
        message = "The joined album exceeded its file-size limit."
        raise AnswerFailedError(message, kind="invalid") from error
    finally:
        resource.setrlimit(resource.RLIMIT_FSIZE, previous)
        signal.signal(signal.SIGXFSZ, handler)


def join_audio(
    tools: tuple[str, str],
    inputs: Sequence[Path],
    output: Path,
    max_bytes: int,
    *,
    on_part: Callable[[int], None] | None = None,
) -> int:
    """Encode the inputs in order and return the validated album's duration in milliseconds."""
    ffmpeg, ffprobe = tools
    with file_limit(max_bytes):
        _encode(ffmpeg, inputs, output, on_part)
    report = _run(
        [
            ffprobe,
            "-v",
            "error",
            "-protocol_whitelist",
            "file",
            "-f",
            "mov",
            "-show_entries",
            "stream=codec_type,codec_name,channels,sample_rate:format=duration",
            "-of",
            "json",
            str(output),
        ],
        "The joined album could not be read as audio.",
    )
    return _duration(report)


def _encode(
    ffmpeg: str,
    inputs: Sequence[Path],
    output: Path,
    on_part: Callable[[int], None] | None,
) -> None:
    args = [
        ffmpeg,
        "-v",
        "error",
        "-xerror",
        "-nostdin",
        "-protocol_whitelist",
        "pipe",
        *_PCM,
        "-i",
        "pipe:0",
        "-c:a",
        "aac",
        "-profile:a",
        "aac_low",
        "-b:a",
        f"{JOIN_OUTPUT_KBPS}k",
        "-movflags",
        "+faststart",
        str(output),
    ]
    try:
        with subprocess.Popen(  # noqa: S603  # nosec B603 -- local tool and controlled arguments
            args, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        ) as encoder:
            try:
                _feed(ffmpeg, inputs, encoder.stdin, on_part)
                if code := encoder.wait(timeout=_TOOL_TIMEOUT):
                    raise subprocess.CalledProcessError(code, args)
            finally:
                if encoder.poll() is None:
                    encoder.kill()
    except (OSError, subprocess.SubprocessError) as error:
        message = "FFmpeg could not join the selected parts within the album file limit."
        raise AnswerFailedError(message, kind="invalid") from error


def _feed(
    ffmpeg: str,
    inputs: Sequence[Path],
    stream: IO[bytes] | None,
    on_part: Callable[[int], None] | None,
) -> None:
    if stream is None:  # pragma: no cover -- the encoder is opened with stdin=PIPE
        message = "FFmpeg's album encoder has no input pipe."
        raise OSError(message)
    with stream:
        for index, path in enumerate(inputs):
            if on_part is not None:
                on_part(index)
            subprocess.run(  # noqa: S603  # nosec B603 -- checked local M4A input
                [
                    ffmpeg,
                    "-v",
                    "error",
                    "-xerror",
                    "-nostdin",
                    "-abort_on",
                    "empty_output",
                    "-protocol_whitelist",
                    "file",
                    "-f",
                    "mov",
                    "-i",
                    str(path),
                    "-map",
                    "0:a:0",
                    *_PCM,
                    "pipe:1",
                ],
                stdin=subprocess.DEVNULL,
                stdout=stream,
                stderr=subprocess.DEVNULL,
                check=True,
                timeout=_TOOL_TIMEOUT,
            )


def _run(args: list[str], failure: str) -> str:
    try:
        result = subprocess.run(  # noqa: S603  # nosec B603 -- local tool and controlled arguments
            args,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            check=True,
            text=True,
            timeout=_TOOL_TIMEOUT,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise AnswerFailedError(failure, kind="invalid") from error
    return result.stdout


def _duration(report: str) -> int:
    try:
        parsed = json.loads(report)
        (stream,) = parsed["streams"]
        seconds = float(parsed["format"]["duration"])
        if (
            stream["codec_type"] == "audio"
            and stream["codec_name"] == "aac"
            and stream["channels"] == _CHANNELS
            and stream["sample_rate"] == str(_SAMPLE_RATE)
            and math.isfinite(seconds)
            and seconds > 0
        ):
            return max(1, round(seconds * 1000))
    except (KeyError, TypeError, ValueError):
        pass
    message = "The joined album did not contain one playable AAC audio stream."
    raise AnswerFailedError(message, kind="invalid")
