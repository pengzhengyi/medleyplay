"""The Job process: load plugins, run one Job's program, and report its progress and outcome.

A program is core code that runs here, never in the server:

```python
def run(request: EchoJob, context: JobContext) -> Echoed:
    context.report(0.5, "Halfway")
    said = context.call(SAY, "parrot", Say(text=request.text))
    return Echoed(text=said.text)


ECHO = JobProgram(EchoJob, Echoed, run)
```
"""

import importlib
import os
import signal
import threading
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import IO, Generic, Literal, TypeVar

from pydantic import BaseModel

from medleyplay.download_receipts import DOWNLOAD_PROGRAM, DownloadStage
from medleyplay.plugin_api import AiEndpoint, AuthError, NetworkError, Operation, ProviderStopError
from medleyplay.plugin_api.progress import ProgressSink, reporting_to
from medleyplay.plugin_host.host import peak_memory
from medleyplay.plugin_host.job_wire import (
    RESULT_FILE,
    DownloadProgress,
    FromJob,
    JobFailed,
    JobFinished,
    JobProgress,
    JobStart,
    KeyOutcome,
)
from medleyplay.plugin_host.loader import Address, Endpoint, load_plugins
from medleyplay.plugin_host.streams import take_standard_streams
from medleyplay.proxy_redaction import redact_proxy

I = TypeVar("I", bound=BaseModel)  # noqa: E741 -- the conventional name for an input
R = TypeVar("R", bound=BaseModel)

type ProgressFrame = JobProgress | DownloadProgress


class PluginCallFailedError(Exception):
    """A plugin call in a Job failed; a program may catch it and carry on."""

    def __init__(
        self,
        kind: Literal["network", "auth", "plugin"],
        message: str,
        plugin: str | None,
        key: str,
        *,
        http_status: int | None = None,
    ) -> None:
        """Record why the call failed, and which provider failed it."""
        super().__init__(message)
        self.kind: Literal["network", "auth", "plugin"] = kind
        self.plugin = plugin
        self.key = key
        self.http_status = http_status


class AnswerFailedError(Exception):
    """A program fails its Job because of what the site answered, not because anything broke.

    `kind` is `gone` when the site no longer has what was asked for, `refused` when
    it refused the request, and `invalid` when it answered with something unusable.
    """

    def __init__(
        self,
        message: str,
        *,
        kind: Literal["gone", "refused", "invalid", "invalid_artifact"],
        part: int | None = None,
    ) -> None:
        """Record why the Job fails."""
        super().__init__(message)
        self.kind = kind
        self.part = part


class ProviderAttemptStoppedError(Exception):
    """Keep the trusted program's selection alongside typed provider evidence."""

    def __init__(self, error: ProviderStopError) -> None:
        """Record the provider's stop reason; the Job program narrows its scope."""
        super().__init__(str(error))
        self.reason = error.reason
        self.media = error.media
        self.status = error.status
        self.video: str | None = None
        self.part: int | None = None


@dataclass
class _KeyRecord:
    plugin: str
    trailing_failures: int = 0
    succeeded: bool = False
    last_failure: str = ""


@dataclass
class JobContext:
    """What a program gets besides its request: plugins, progress, and its working folder."""

    work_dir: Path
    _endpoints: Mapping[Address, Endpoint]
    _send: Callable[[ProgressFrame], None]
    login: Path | None = None
    """A copy of the login the Job was given, readable by its owner alone, or `None`."""
    proxy: str | None = field(default=None, repr=False)
    """The household's proxy for the Job's site, or `None`; held in memory only."""
    ai: tuple[AiEndpoint, ...] = field(default=(), repr=False)
    """The AI providers the Job is lent, in order, keys included; held in memory only."""
    tavily_key: str | None = field(default=None, repr=False)
    held_videos: tuple[str, ...] = ()
    _keys: dict[str, _KeyRecord] = field(default_factory=dict)
    _download_stage: tuple[DownloadStage, int | None] | None = None
    _download_reported_at: float = 0.0

    def safe_text(self, text: str) -> str:
        """Remove the borrowed proxy and its credentials from text a program keeps."""
        if self.proxy:
            text = text.replace(self.proxy, "<redacted>")
        return redact_proxy(text, self.proxy)

    def report(self, fraction: float | None = None, message: str = "") -> None:
        """Tell the server how far the Job has got.

        A Job that reports nothing for its kind's idle timeout is killed, so a long
        step reports as it goes.
        """
        self._send(JobProgress(fraction=fraction, message=message, peak_memory=peak_memory()))

    def report_download(
        self,
        stage: DownloadStage,
        fraction: float | None = None,
        *,
        part: int | None = None,
        current: int | None = None,
        total: int | None = None,
    ) -> None:
        """Report a stage change immediately and sample its progress at most once per second."""
        now = time.monotonic()
        key = (stage, part)
        if self._download_stage == key and now - self._download_reported_at < 1:
            return
        self._download_stage = key
        self._download_reported_at = now
        self._send(
            DownloadProgress(
                stage=stage,
                fraction=fraction,
                part=part,
                current=current,
                total=total,
                peak_memory=peak_memory(),
            )
        )

    def call[P, In: BaseModel, Out: BaseModel](
        self,
        operation: Operation[P, In, Out],
        key: str,
        request: In,
        *,
        progress: ProgressSink | None = None,
    ) -> Out:
        """Call `operation` on the provider for `key`; raise `PluginCallFailedError` on failure."""
        endpoint = self._endpoints.get((operation.point.name, key, operation.name))
        if endpoint is None:
            message = f"No plugin that is on answers {operation.point.name} for {key!r}."
            raise PluginCallFailedError(kind="plugin", message=message, plugin=None, key=key)
        record = self._keys.setdefault(key, _KeyRecord(endpoint.plugin))
        try:
            with reporting_to(self.report if progress is None else progress):
                reply = endpoint.invoke(request)
        except NetworkError as error:
            raise PluginCallFailedError(
                kind="network",
                message=str(error),
                plugin=endpoint.plugin,
                key=key,
                http_status=error.http_status,
            ) from error
        except AuthError as error:
            raise PluginCallFailedError(
                kind="auth", message=str(error), plugin=endpoint.plugin, key=key
            ) from error
        except ProviderStopError as error:
            raise ProviderAttemptStoppedError(error) from error
        except (Exception, SystemExit) as error:
            message = f"{type(error).__name__}: {error}"
            record.trailing_failures += 1
            record.last_failure = message
            raise PluginCallFailedError(
                kind="plugin", message=message, plugin=endpoint.plugin, key=key
            ) from error
        record.trailing_failures = 0
        record.succeeded = True
        if not isinstance(reply, operation.reply):  # pragma: no cover -- invoke checks the type
            raise TypeError(reply)
        return reply

    def outcomes(self) -> tuple[KeyOutcome, ...]:
        """Return how each key's calls went, for the plugins' circuit breakers."""
        return tuple(
            KeyOutcome(
                plugin=record.plugin,
                key=key,
                trailing_failures=record.trailing_failures,
                succeeded=record.succeeded,
                last_failure=record.last_failure,
            )
            for key, record in sorted(self._keys.items())
        )


@dataclass(frozen=True)
class JobProgram(Generic[I, R]):  # noqa: UP046 -- invariant, as Operation is
    """A Job kind's program: its request and result models, and the function to run."""

    request: type[I]
    result: type[R]
    run: Callable[[I, JobContext], R]


def main() -> int:
    """Run the one Job the server sends, then exit."""
    protocol_in, protocol_out = take_standard_streams()

    def send(message: FromJob) -> None:
        protocol_out.write(message.model_dump_json() + "\n")
        protocol_out.flush()

    start = JobStart.model_validate_json(protocol_in.readline())
    threading.Thread(target=_end_with_the_server, args=(protocol_in,), daemon=True).start()
    send(run_job(start, send))
    return 0


def run_job(start: JobStart, send: Callable[[ProgressFrame], None]) -> JobFinished | JobFailed:
    """Run `start`'s program and return its outcome, writing its result to the working folder."""
    if start.program != DOWNLOAD_PROGRAM:
        return _run_job(start, send)

    def report(frame: ProgressFrame) -> None:
        if isinstance(frame, DownloadProgress):
            send(frame)

    outcome = _run_job(start, report)
    outcomes = tuple(each.model_copy(update={"last_failure": ""}) for each in outcome.outcomes)
    if isinstance(outcome, JobFailed):
        return outcome.model_copy(
            update={
                "outcomes": outcomes,
                "message": "",
                "plugin": None,
                "key": None,
                "provider_video": None,
            }
        )
    return outcome.model_copy(update={"outcomes": outcomes})


def _run_job(start: JobStart, send: Callable[[ProgressFrame], None]) -> JobFinished | JobFailed:
    work_dir = Path(start.work_dir)
    endpoints = load_plugins(start.package, start.plugins, lambda _: None)
    context = JobContext(
        work_dir,
        endpoints,
        send,
        login=Path(start.login) if start.login else None,
        proxy=start.proxy,
        ai=start.ai,
        tavily_key=start.tavily_key,
        held_videos=start.held_videos,
    )
    try:
        program = _program(start.program)
        result = program.run(program.request.model_validate(start.request), context)
        (work_dir / RESULT_FILE).write_text(result.model_dump_json(), encoding="utf-8")
    except PluginCallFailedError as error:
        return JobFailed(
            kind=error.kind,
            message=str(error),
            plugin=error.plugin,
            key=error.key,
            outcomes=context.outcomes(),
            peak_memory=peak_memory(),
            http_status=error.http_status,
        )
    except AnswerFailedError as error:
        return JobFailed(
            kind=error.kind,
            message=str(error),
            outcomes=context.outcomes(),
            peak_memory=peak_memory(),
            provider_part=error.part,
        )
    except ProviderAttemptStoppedError as error:
        return JobFailed(
            kind=error.reason,
            message=context.safe_text(str(error)),
            outcomes=context.outcomes(),
            peak_memory=peak_memory(),
            provider_video=error.video,
            provider_part=error.part,
            http_status=error.status,
        )
    except (Exception, SystemExit) as error:  # noqa: BLE001 -- the program's own fault
        return JobFailed(
            kind="program",
            message=f"{type(error).__name__}: {error}",
            outcomes=context.outcomes(),
            peak_memory=peak_memory(),
        )
    return JobFinished(outcomes=context.outcomes(), peak_memory=peak_memory())


def _program(path: str) -> JobProgram[BaseModel, BaseModel]:
    module_name, _, attribute = path.partition(":")
    program = getattr(importlib.import_module(module_name), attribute, None)
    if not isinstance(program, JobProgram):
        message = f"{path} isn't a JobProgram."
        raise TypeError(message)
    return program


def _end_with_the_server(protocol_in: IO[str]) -> None:
    # The server sends nothing after the start, so end of file means it has gone.
    # Killing the whole group also ends any program the Job started, such as a
    # downloader.
    protocol_in.read()
    os.killpg(os.getpgrp(), signal.SIGKILL)
