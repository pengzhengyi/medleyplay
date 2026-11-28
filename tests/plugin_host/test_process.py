"""The download pipe accepts bounded frames without copying child stderr to the server."""

# cspell:ignore capfd

import sys

import pytest

from medleyplay.plugin_host.job_wire import FROM_JOB, JobFinished
from medleyplay.plugin_host.process import ChildExitedError, ChildProcess, HostCommand


def test_an_oversized_download_frame_is_not_delivered(
    capfd: pytest.CaptureFixture[str],
) -> None:
    command = HostCommand(
        (
            sys.executable,
            "-c",
            """
import sys

print("private-provider-sentinel", file=sys.stderr, flush=True)
print("x" * 100_000, flush=True)
""",
        )
    )
    process = ChildProcess(command, FROM_JOB, bounded_output=True)

    try:
        with pytest.raises(ChildExitedError):
            process.receive(5)
    finally:
        process.kill()

    assert capfd.readouterr().err == ""


def test_a_full_queue_keeps_the_terminal_frame_after_a_burst_of_progress() -> None:
    command = HostCommand(
        (
            sys.executable,
            "-c",
            """
for _ in range(100):
    print('{"type":"download_progress","stage":"transfer","peak_memory":1}')
print('{"type":"finished","peak_memory":1}')
""",
        )
    )
    process = ChildProcess(command, FROM_JOB, bounded_output=True)

    try:
        progress = [process.receive(5) for _ in range(100)]
        outcome = process.receive(5)
    finally:
        process.kill()

    assert all(frame.type == "download_progress" for frame in progress)
    assert isinstance(outcome, JobFinished)
