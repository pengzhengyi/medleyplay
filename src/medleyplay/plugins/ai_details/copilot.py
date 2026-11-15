"""Asking GitHub Copilot, through GitHub's Copilot SDK, as the other providers are asked.

A provider at `COPILOT_BASE_URL` is Copilot: its key is a GitHub token of an account
with Copilot, and its model one the subscription offers, such as `gpt-5-mini`. The
SDK runs Copilot's own runtime as a child process, downloading it on first use. It
is given no tool, rejects every permission it would ask for, works in an empty
directory removed after, and its system message is the one given, replacing
Copilot's own, so it only reads the question and answers it.

The token goes to the SDK and nowhere else, and no message raised holds the token or
what Copilot said. Each question counts against the account's Copilot allowance.
"""

import asyncio
import tempfile
from collections.abc import Callable, Sequence
from typing import Final, Protocol

from copilot import CopilotClient, JsonRpcError
from copilot.generated.rpc import PermissionDecisionReject
from copilot.generated.session_events import AssistantMessageData

from medleyplay.plugin_api import AiEndpoint, AiFailureReason, NetworkError
from medleyplay.plugins.ai_details.client import (
    ChatClient,
    Message,
    RefusedError,
    UnusableAnswerError,
)

COPILOT_BASE_URL: Final = "https://api.githubcopilot.com"
"""The address that names GitHub Copilot among the providers."""
TIMEOUT: Final = 90.0
"""How long, in seconds, Copilot may take to answer."""


class _Session(Protocol):
    async def send_and_wait(self, prompt: str, *, timeout: float = ...) -> object: ...  # noqa: ASYNC109 -- the SDK's


class _Status(Protocol):
    @property
    def isAuthenticated(self) -> bool: ...  # noqa: N802 -- the SDK's own name


class Runtime(Protocol):
    """What this module uses of the SDK's client of Copilot's runtime."""

    async def start(self) -> None: ...  # noqa: D102
    async def stop(self) -> object: ...  # noqa: D102
    async def get_auth_status(self) -> _Status: ...  # noqa: D102
    async def create_session(self, **options: object) -> _Session: ...  # noqa: D102


type StartRuntime = Callable[[str, str], Runtime]
"""Start a runtime that signs in with a token and works in a directory."""


def is_copilot(endpoint: AiEndpoint) -> bool:
    """Return whether `endpoint` is GitHub Copilot."""
    return endpoint.base_url.rstrip("/") == COPILOT_BASE_URL


def _runtime(token: str, directory: str) -> Runtime:
    # It has what `Runtime` names, and more.
    return CopilotClient(  # type: ignore[return-value]
        github_token=token,
        use_logged_in_user=False,
        working_directory=directory,
        log_level="error",
    )


def _reject(request: object, invocation: object) -> PermissionDecisionReject:
    """Reject whatever Copilot asks to do: it only answers the question."""
    del request, invocation
    return PermissionDecisionReject(feedback="Only answer the question.")


class CopilotChat:
    """Asks GitHub Copilot for one reply, as `ChatClient` asks the other providers."""

    def __init__(self, start: StartRuntime = _runtime) -> None:
        """Ask through runtimes `start` gives."""
        self._start = start

    def handles(self, endpoint: AiEndpoint) -> bool:
        """Return whether `endpoint` is GitHub Copilot."""
        return is_copilot(endpoint)

    def complete(
        self, endpoint: AiEndpoint, messages: Sequence[Message], *, patient: bool = True
    ) -> str:
        """Return what Copilot's model says in answer to `messages`, as text.

        Raise `RefusedError` for no token or one GitHub refuses, `UnusableAnswerError`
        for a model the subscription doesn't offer or an empty reply, and
        `NetworkError` for Copilot not answering. `patient` changes nothing: the SDK
        waits out a busy Copilot itself.
        """
        del patient
        if not endpoint.key:
            message = "GitHub Copilot is asked with a GitHub token of an account with Copilot."
            raise RefusedError(message)
        system, prompt = _split(messages)
        with tempfile.TemporaryDirectory(prefix="medleyplay-copilot-") as directory:
            runtime = self._start(endpoint.key, directory)
            try:
                return asyncio.run(self._ask(runtime, endpoint.model, system, prompt, directory))
            except (TimeoutError, OSError, JsonRpcError) as error:
                # Only the kind of failure: the runtime's words can name the account.
                message = f"GitHub Copilot didn't answer: {type(error).__name__}."
                raise NetworkError(message) from None

    @staticmethod
    async def _ask(runtime: Runtime, model: str, system: str, prompt: str, directory: str) -> str:
        await runtime.start()
        try:
            status = await runtime.get_auth_status()
            if not status.isAuthenticated:
                message = (
                    "GitHub refused the token: replace it with one of an account with Copilot."
                )
                raise RefusedError(message)
            try:
                session = await runtime.create_session(
                    model=model,
                    available_tools=[],
                    system_message={"mode": "replace", "content": system},
                    on_permission_request=_reject,
                    working_directory=directory,
                )
            except JsonRpcError:
                message = "GitHub Copilot refused the session: check the model."
                raise UnusableAnswerError(message, AiFailureReason.REJECTED) from None
            event = await session.send_and_wait(prompt, timeout=TIMEOUT)
        finally:
            await runtime.stop()
        data = getattr(event, "data", None)
        if not isinstance(data, AssistantMessageData) or not data.content.strip():
            message = "GitHub Copilot's answer was empty: check the model."
            raise UnusableAnswerError(message, AiFailureReason.EMPTY)
        return data.content


def _split(messages: Sequence[Message]) -> tuple[str, str]:
    """Return the system message, and the rest as one prompt.

    A reply asked for again reads as the question, the answer it got, and what was
    wrong with it.
    """
    system = "\n\n".join(each["content"] for each in messages if each["role"] == "system")
    parts = [
        f"Your answer was:\n{each['content']}" if each["role"] == "assistant" else each["content"]
        for each in messages
        if each["role"] != "system"
    ]
    return system, "\n\n".join(parts)


def chat_client() -> ChatClient:
    """Return a client that asks the OpenAI-compatible providers, and Copilot through its SDK."""
    return ChatClient(copilot=CopilotChat())
