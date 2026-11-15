"""Asking GitHub Copilot through its SDK: only a question, no tools, the token kept close."""

from dataclasses import dataclass, field
from pathlib import Path

import pytest
from copilot import JsonRpcError
from copilot.generated.rpc import PermissionDecisionReject
from copilot.generated.session_events import AssistantMessageData

from medleyplay.domain.ai import PRESETS
from medleyplay.plugin_api import AiEndpoint, AiFailureReason, NetworkError
from medleyplay.plugins.ai_details.client import (
    ChatClient,
    Message,
    RefusedError,
    UnusableAnswerError,
)
from medleyplay.plugins.ai_details.copilot import COPILOT_BASE_URL, CopilotChat
from tests.support.transport import FakeTransport

pytestmark = pytest.mark.usefixtures("no_outside_network")

TOKEN = "github_pat_0123456789abcdef"
COPILOT = AiEndpoint(id="copilot", base_url=COPILOT_BASE_URL, model="gpt-5-mini", key=TOKEN)
"""GitHub Copilot's `gpt-5-mini`, asked with a GitHub token."""
ASKED: list[Message] = [
    {"role": "system", "content": "Reply with one json object."},
    {"role": "user", "content": "Which songs does this video hold?"},
]


@dataclass
class _Reply:
    """An event as the SDK gives one back."""

    data: object


@dataclass
class _Session:
    """A Copilot session that answers with `reply`, or raises `failure`."""

    reply: object
    failure: BaseException | None = None
    sent: list[tuple[str, float]] = field(default_factory=list)

    async def send_and_wait(self, prompt: str, *, timeout: float = 60.0) -> object:  # noqa: ASYNC109 -- the SDK's own signature
        self.sent.append((prompt, timeout))
        if self.failure is not None:
            raise self.failure
        return self.reply


@dataclass
class _Status:
    isAuthenticated: bool  # noqa: N815 -- the SDK's own name


@dataclass
class FakeRuntime:
    """Copilot's runtime as the SDK drives it, recording what it was started and asked with."""

    session: _Session
    signed_in: bool = True
    refuse_model: bool = False
    token: str = ""
    directory: str = ""
    options: dict[str, object] = field(default_factory=dict)
    stopped: bool = False

    async def start(self) -> None:
        pass

    async def stop(self) -> None:
        self.stopped = True

    async def get_auth_status(self) -> _Status:
        return _Status(isAuthenticated=self.signed_in)

    async def create_session(self, **options: object) -> _Session:
        self.options = options
        if self.refuse_model:
            raise JsonRpcError(-32603, "Model gpt-5-mini is not available")
        return self.session


def answering(content: str, **change: object) -> FakeRuntime:
    """A signed-in runtime whose model says `content`."""
    session = _Session(_Reply(AssistantMessageData(content=content, message_id="m1")))
    return FakeRuntime(session, **change)  # type: ignore[arg-type]


def chat_over(runtime: FakeRuntime) -> CopilotChat:
    """Copilot, asked through `runtime`, which notes the token and directory it gets."""

    def start(token: str, directory: str) -> FakeRuntime:
        runtime.token, runtime.directory = token, directory
        return runtime

    return CopilotChat(start)


def test_copilot_is_asked_with_the_token_and_model_and_its_reply_returned() -> None:
    runtime = answering('{"songs": []}')

    said = chat_over(runtime).complete(COPILOT, ASKED)

    assert said == '{"songs": []}'
    assert (runtime.token, runtime.options["model"]) == (TOKEN, "gpt-5-mini")
    assert runtime.session.sent[0][0] == "Which songs does this video hold?"
    assert runtime.stopped


def test_copilot_gets_no_tool_no_permission_and_only_the_system_message_given() -> None:
    runtime = answering("{}")

    chat_over(runtime).complete(COPILOT, ASKED)

    assert runtime.options["available_tools"] == []
    assert runtime.options["system_message"] == {
        "mode": "replace",
        "content": "Reply with one json object.",
    }
    decide = runtime.options["on_permission_request"]
    assert callable(decide)
    assert isinstance(decide(object(), {}), PermissionDecisionReject)


def test_copilot_works_in_an_empty_directory_removed_after() -> None:
    runtime = answering("{}")

    chat_over(runtime).complete(COPILOT, ASKED)

    assert runtime.options["working_directory"] == runtime.directory
    assert not Path(runtime.directory).exists()


def test_asking_again_shows_copilot_its_answer_and_what_was_wrong() -> None:
    runtime = answering("{}")
    again: list[Message] = [
        *ASKED,
        {"role": "assistant", "content": "Two songs."},
        {"role": "user", "content": "That was not json."},
    ]

    chat_over(runtime).complete(COPILOT, again)

    assert runtime.session.sent[0][0] == (
        "Which songs does this video hold?\n\nYour answer was:\nTwo songs.\n\nThat was not json."
    )


def test_a_token_github_does_not_accept_is_a_refusal_that_never_repeats_it() -> None:
    runtime = answering("{}", signed_in=False)

    with pytest.raises(RefusedError) as refused:
        chat_over(runtime).complete(COPILOT, ASKED)

    assert TOKEN not in str(refused.value)
    assert runtime.session.sent == []


def test_copilot_without_a_token_is_a_refusal() -> None:
    runtime = answering("{}")

    with pytest.raises(RefusedError, match="GitHub token"):
        chat_over(runtime).complete(COPILOT.model_copy(update={"key": None}), ASKED)


def test_a_model_the_subscription_does_not_offer_is_an_unusable_answer() -> None:
    runtime = answering("{}", refuse_model=True)

    with pytest.raises(UnusableAnswerError) as unusable:
        chat_over(runtime).complete(COPILOT, ASKED)

    assert unusable.value.reason is AiFailureReason.REJECTED


def test_an_empty_reply_is_an_unusable_answer() -> None:
    runtime = answering("  ")

    with pytest.raises(UnusableAnswerError) as unusable:
        chat_over(runtime).complete(COPILOT, ASKED)

    assert unusable.value.reason is AiFailureReason.EMPTY


@pytest.mark.parametrize("failure", [TimeoutError(), ConnectionResetError()])
def test_copilot_not_answering_is_a_network_failure(failure: BaseException) -> None:
    runtime = answering("{}")
    runtime.session.failure = failure

    with pytest.raises(NetworkError, match="Copilot"):
        chat_over(runtime).complete(COPILOT, ASKED)

    assert runtime.stopped


def test_the_chat_client_asks_copilot_through_the_sdk_and_sends_nothing_itself() -> None:
    fake = FakeTransport()
    runtime = answering('{"songs": []}')

    said = ChatClient(fake.session(), copilot=chat_over(runtime)).complete(COPILOT, ASKED)

    assert said == '{"songs": []}'
    assert fake.sent == []


def test_the_github_copilot_preset_is_asked_through_the_sdk() -> None:
    [preset] = [each for each in PRESETS if each.name == "GitHub Copilot"]

    assert preset.base_url == COPILOT_BASE_URL
