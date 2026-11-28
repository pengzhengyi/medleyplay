"""A child process of the server speaking JSON lines, read with timeouts and killed as a group."""

import contextlib
import os
import queue
import signal
import subprocess  # nosec B404 -- starts only the core's own modules
import sys
import threading
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import IO, Final

from pydantic import BaseModel, TypeAdapter, ValidationError

from medleyplay.plugin_host.wire import MAX_LINE

_STOP_GRACE: Final = 2.0
_DOWNLOAD_LINE: Final = 16 * 1024
_DOWNLOAD_BACKLOG: Final = 32


@dataclass(frozen=True)
class HostCommand:
    """How to start a plugin host or Job process: the core's own module, under this Python."""

    argv: tuple[str, ...] = (sys.executable, "-m", "medleyplay.plugin_host")
    env: Mapping[str, str] | None = None


class ChildTimeoutError(Exception):
    """The child sent nothing before the timeout."""


class ChildExitedError(Exception):
    """The child exited, closed its pipe, or sent a line that isn't a message."""


class ChildProcess[T]:
    """A child in its own process group, with a thread reading its lines so reads can time out."""

    def __init__(
        self,
        command: HostCommand,
        messages: TypeAdapter[T],
        *,
        args: Sequence[str] = (),
        pass_fds: Sequence[int] = (),
        bounded_output: bool = False,
    ) -> None:
        """Start the child; `messages` parses each line it sends."""
        env = None if command.env is None else {**os.environ, **command.env}
        self._messages = messages
        self._closed = threading.Event()
        self._max_line = _DOWNLOAD_LINE if bounded_output else MAX_LINE
        # The argv is the server's own interpreter running a module of the core.
        self._popen = subprocess.Popen(  # noqa: S603  # nosec B603
            (*command.argv, *args),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL if bounded_output else None,
            text=True,
            encoding="utf-8",
            env=env,
            start_new_session=True,
            pass_fds=tuple(pass_fds),
        )
        self._lines: queue.Queue[str | None] = queue.Queue(
            _DOWNLOAD_BACKLOG if bounded_output else 0
        )
        threading.Thread(target=self._read, args=(_pipe(self._popen.stdout),), daemon=True).start()

    @property
    def pid(self) -> int:
        """Return the child's process id, which is also its process group's id."""
        return self._popen.pid

    def _read(self, stdout: IO[str]) -> None:
        with contextlib.suppress(ValueError, OSError, UnicodeError):
            while line := stdout.readline(self._max_line + 1):
                if len(line) > self._max_line or not self._enqueue(line):
                    break
        self._enqueue(None)

    def _enqueue(self, line: str | None) -> bool:
        while not self._closed.is_set():
            try:
                self._lines.put(line, timeout=0.1)
            except queue.Full:
                continue
            return True
        return False

    def alive(self) -> bool:
        """Return whether the child is still running."""
        return self._popen.poll() is None

    def send(self, message: BaseModel) -> None:
        """Send one message; raise `ChildExitedError` when the child has gone."""
        stdin = _pipe(self._popen.stdin)
        try:
            stdin.write(message.model_dump_json() + "\n")
            stdin.flush()
        except (BrokenPipeError, ValueError) as error:
            raise ChildExitedError from error

    def receive(self, timeout: float) -> T:
        """Return the child's next message, waiting at most `timeout` seconds."""
        if self._closed.is_set() and self._lines.empty():
            raise ChildExitedError
        try:
            line = self._lines.get(timeout=max(timeout, 0))
        except queue.Empty:
            raise ChildTimeoutError from None
        if line is None or not line.endswith("\n"):
            raise ChildExitedError
        try:
            return self._messages.validate_json(line)
        except ValidationError as error:
            raise ChildExitedError from error

    def stop(self) -> None:
        """Close the child's input, which ends it, and kill it if it doesn't exit at once."""
        with contextlib.suppress(OSError):
            _pipe(self._popen.stdin).close()
        with contextlib.suppress(subprocess.TimeoutExpired):
            self._popen.wait(timeout=_STOP_GRACE)
        self.kill()

    def finish(self) -> None:
        """Let a child that has said its last word exit, killing it if it doesn't at once."""
        with contextlib.suppress(subprocess.TimeoutExpired):
            self._popen.wait(timeout=_STOP_GRACE)
        self.kill()

    def kill(self) -> None:
        """Kill the child's whole process group, and reap the child."""
        self._closed.set()
        with contextlib.suppress(queue.Full):
            self._lines.put_nowait(None)
        kill_group(self._popen.pid)
        self._popen.wait()
        for pipe in (self._popen.stdin, self._popen.stdout):
            if pipe is not None:
                with contextlib.suppress(OSError):
                    pipe.close()


def kill_group(pid: int) -> None:
    """Kill the process group `pid` leads, if it still exists."""
    with contextlib.suppress(ProcessLookupError, PermissionError):
        os.killpg(pid, signal.SIGKILL)


def _pipe(pipe: IO[str] | None) -> IO[str]:
    if pipe is None:  # pragma: no cover -- Popen opens every pipe it is asked for
        message = "The child was started without its pipes."
        raise RuntimeError(message)
    return pipe
