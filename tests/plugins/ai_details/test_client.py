"""The chat client speaks the OpenAI chat protocol that the common providers share."""

import json

import pytest
import requests

from medleyplay.plugin_api import AiEndpoint, NetworkError
from medleyplay.plugins.ai_details.client import (
    DEFAULT_WAIT,
    MAX_ATTEMPTS,
    MAX_TOKENS,
    MAX_WAIT,
    TIMEOUT,
    ChatClient,
    Message,
    RefusedError,
    UnusableAnswerError,
)
from tests.support.ai import CHAT, DEEPSEEK, KEY, AiEndpointFactory, ChatReplyFactory, FakeAiFactory
from tests.support.transport import FakeTransport, FakeWaits, Reply

pytestmark = pytest.mark.usefixtures("no_outside_network")

MESSAGES: list[Message] = [
    {"role": "system", "content": "Reply with json like {}."},
    {"role": "user", "content": "Video title: Night Drive"},
]
BUSY = Reply(429, {"Retry-After": "3"})
SAYS_HI = ChatReplyFactory.saying("hi")


def client_of(fake: FakeTransport, waits: FakeWaits | None = None) -> ChatClient:
    """A client whose requests go to `fake`, and whose waiting is `waits`'."""
    return ChatClient(fake.session(), sleep=(waits or FakeWaits()).sleep)


def ask(
    fake: FakeTransport, endpoint: AiEndpoint | None = None, waits: FakeWaits | None = None
) -> str:
    """Ask the chat once through a client over `fake`, as DeepSeek unless told otherwise."""
    return client_of(fake, waits).complete(endpoint or AiEndpointFactory.deepseek(), MESSAGES)


# What is sent


def test_one_post_goes_to_the_chat_completions_of_the_base_url() -> None:
    fake = FakeAiFactory.answering(SAYS_HI)

    ask(fake)

    assert [(each.method, each.url) for each in fake.sent] == [("POST", CHAT)]


@pytest.mark.parametrize(
    ("base_url", "chat"),
    [
        ("https://api.deepseek.com", "https://api.deepseek.com/chat/completions"),
        ("https://api.deepseek.com/", "https://api.deepseek.com/chat/completions"),
        ("https://api.openai.com/v1", "https://api.openai.com/v1/chat/completions"),
        ("https://api.openai.com/v1/", "https://api.openai.com/v1/chat/completions"),
        ("https://api.anthropic.com/v1", "https://api.anthropic.com/v1/chat/completions"),
        ("https://api.anthropic.com/v1/", "https://api.anthropic.com/v1/chat/completions"),
        ("http://127.0.0.1:11434/v1", "http://127.0.0.1:11434/v1/chat/completions"),
        ("http://127.0.0.1:11434/v1/", "http://127.0.0.1:11434/v1/chat/completions"),
    ],
)
def test_the_chat_url_joins_the_base_url_with_or_without_a_trailing_slash(
    base_url: str, chat: str
) -> None:
    fake = FakeAiFactory.answering(SAYS_HI, url=chat)

    ask(fake, AiEndpointFactory.at(base_url))

    assert fake.urls() == [chat]


def test_the_body_asks_for_a_json_object_from_the_model_at_temperature_zero() -> None:
    fake = FakeAiFactory.answering(SAYS_HI)

    ask(fake)

    assert fake.body() == {
        "model": "deepseek-flash",
        "messages": MESSAGES,
        "response_format": {"type": "json_object"},
        "temperature": 0,
        "max_tokens": MAX_TOKENS,
    }


def test_the_body_asks_for_nothing_only_some_of_the_providers_accept() -> None:
    fake = FakeAiFactory.answering(SAYS_HI)

    ask(fake)

    assert {"stream", "tools", "tool_choice", "functions"} & set(fake.body()) == set()
    assert fake.body()["response_format"] != {"type": "json_schema"}


def test_the_key_goes_in_the_authorization_header_and_nowhere_else() -> None:
    fake = FakeAiFactory.answering(SAYS_HI)

    ask(fake)

    request = fake.sent[0]
    assert request.headers["Authorization"] == f"Bearer {KEY}"
    assert KEY not in (request.url or "")
    assert KEY not in json.dumps(fake.body())
    assert [value for name, value in request.headers.items() if KEY in value] == [f"Bearer {KEY}"]


def test_a_provider_without_a_key_is_sent_no_authorization() -> None:
    fake = FakeAiFactory.answering(SAYS_HI, url="http://127.0.0.1:11434/v1/chat/completions")

    ask(fake, AiEndpointFactory.ollama())

    assert "Authorization" not in fake.sent[0].headers


def test_the_body_is_json() -> None:
    fake = FakeAiFactory.answering(SAYS_HI)

    ask(fake)

    assert fake.sent[0].headers["Content-Type"] == "application/json"


def test_the_request_may_take_the_time_the_client_allows() -> None:
    fake = FakeAiFactory.answering(SAYS_HI)

    ask(fake)

    assert fake.timeouts == [TIMEOUT]


def test_a_redirect_is_not_followed_so_the_key_goes_nowhere_else() -> None:
    fake = FakeTransport().answer(CHAT, Reply.redirect("https://elsewhere.example/chat"))

    with pytest.raises(UnusableAnswerError, match="redirect"):
        ask(fake)

    assert fake.urls() == [CHAT]


# What is read


def test_the_answer_is_the_first_choices_message() -> None:
    fake = FakeAiFactory.answering(ChatReplyFactory.saying('{"title": "Night Drive"}'))

    assert ask(fake) == '{"title": "Night Drive"}'


@pytest.mark.parametrize(
    "reply",
    [
        ChatReplyFactory.saying("cut off", finish_reason="length"),
        ChatReplyFactory.saying(""),
        ChatReplyFactory.saying("   \n"),
        Reply.json({"choices": []}),
        Reply.json({"choices": [{"message": {"content": None}, "finish_reason": "stop"}]}),
        Reply.json({"choices": [{"finish_reason": "stop"}]}),
        Reply.json({"error": "no choices"}),
        Reply.json(["not", "an", "object"]),
    ],
    ids=[
        "the model ran out of tokens",
        "empty content",
        "blank content",
        "no choices",
        "null content",
        "no message",
        "no choices key",
        "not an object",
    ],
)
def test_an_answer_that_is_cut_off_or_empty_is_unusable(reply: Reply) -> None:
    with pytest.raises(UnusableAnswerError):
        ask(FakeAiFactory.answering(reply))


def test_an_answer_cut_off_says_the_model_ran_out_of_room() -> None:
    fake = FakeAiFactory.answering(ChatReplyFactory.saying("{", finish_reason="length"))

    with pytest.raises(UnusableAnswerError, match="ran out of room"):
        ask(fake)


@pytest.mark.parametrize("status", [400, 404, 422])
def test_another_refusal_of_the_request_says_to_check_the_address_and_the_model(
    status: int,
) -> None:
    fake = FakeAiFactory.answering(Reply(status, body=b'{"error": {"message": "no such model"}}'))

    with pytest.raises(UnusableAnswerError, match=rf"{status}.*base URL and the model"):
        ask(fake)


def test_an_answer_that_is_not_json_is_a_network_failure() -> None:
    # Such as a network's sign-in page, answering in the provider's place.
    fake = FakeAiFactory.answering(
        Reply(200, {"Content-Type": "text/html"}, b"<html>Sign in</html>")
    )

    with pytest.raises(NetworkError, match="not JSON"):
        ask(fake)


# What the provider refuses


@pytest.mark.parametrize("status", [401, 403])
def test_a_key_or_an_account_the_provider_refuses_is_a_refusal_that_says_to_check_the_key(
    status: int,
) -> None:
    fake = FakeAiFactory.answering(Reply(status, body=f"bad key {KEY}".encode()))

    with pytest.raises(RefusedError, match=rf"{status}.*[Cc]heck the key") as refused:
        ask(fake)

    assert KEY not in str(refused.value)


# What the provider is too busy for


def test_a_busy_provider_is_waited_out_as_long_as_it_says_and_asked_again() -> None:
    waits = FakeWaits()
    fake = FakeAiFactory.answering(BUSY, SAYS_HI)

    assert ask(fake, waits=waits) == "hi"
    assert (waits.pauses, len(fake.sent)) == ([3.0], 2)


@pytest.mark.parametrize("status", [429, 500, 502, 503, 529])
def test_a_provider_that_is_too_busy_or_failing_is_waited_out(status: int) -> None:
    waits = FakeWaits()
    fake = FakeAiFactory.answering(Reply(status, {"Retry-After": "2"}), SAYS_HI)

    ask(fake, waits=waits)

    assert waits.pauses == [2.0]


def test_a_busy_provider_that_says_nothing_of_the_wait_is_waited_for_a_default_time() -> None:
    waits = FakeWaits()
    fake = FakeAiFactory.answering(Reply(429), SAYS_HI)

    ask(fake, waits=waits)

    assert waits.pauses == [DEFAULT_WAIT]


def test_a_provider_that_stays_busy_is_a_network_failure_after_a_few_tries() -> None:
    waits = FakeWaits()
    fake = FakeAiFactory.answering(BUSY)

    with pytest.raises(NetworkError, match="too busy"):
        ask(fake, waits=waits)

    assert len(fake.sent) == MAX_ATTEMPTS
    assert waits.pauses == [3.0] * (MAX_ATTEMPTS - 1)


def test_a_wait_longer_than_the_client_will_wait_is_a_network_failure_at_once() -> None:
    waits = FakeWaits()
    fake = FakeAiFactory.answering(Reply(429, {"Retry-After": str(MAX_WAIT + 1)}))

    with pytest.raises(NetworkError, match="too busy"):
        ask(fake, waits=waits)

    assert (len(fake.sent), waits.pauses) == (1, [])


def test_a_busy_provider_that_gives_a_date_for_the_wait_is_waited_for_the_default_time() -> None:
    waits = FakeWaits()
    date = "Wed, 21 Oct 2026 07:28:00 GMT"
    fake = FakeAiFactory.answering(Reply(429, {"Retry-After": date}), SAYS_HI)

    ask(fake, waits=waits)

    assert waits.pauses == [DEFAULT_WAIT]


# What cannot be reached


@pytest.mark.parametrize(
    "failure",
    [requests.ConnectionError(), requests.Timeout(), requests.exceptions.SSLError()],
    ids=["no connection", "timeout", "TLS"],
)
def test_a_provider_that_cannot_be_reached_is_a_network_failure_naming_only_the_kind(
    failure: requests.RequestException,
) -> None:
    fake = FakeAiFactory.answering(failure)

    with pytest.raises(NetworkError) as unreached:
        ask(fake)

    assert type(failure).__name__ in str(unreached.value)
    assert DEEPSEEK not in str(unreached.value)


def test_what_a_failure_says_is_never_the_key_even_when_the_library_would_print_it() -> None:
    fake = FakeAiFactory.answering(requests.ConnectionError(f"Bearer {KEY} refused at {CHAT}"))

    with pytest.raises(NetworkError) as unreached:
        ask(fake)

    assert KEY not in str(unreached.value)
