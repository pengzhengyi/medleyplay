"""A small client for the chat of an OpenAI-compatible provider.

It sends only what DeepSeek, OpenAI, Anthropic's compatible endpoint, and a local
Ollama all accept: a model, messages, JSON mode, temperature 0, and a bound on the
answer. The key goes in the `Authorization` header and nowhere else, and no message
the client raises holds the key, the request, or the provider's own words.

A 429 or a 5xx is the provider being busy or failing, so a patient client waits as
long as `Retry-After` says, a few times, and then gives up as a network failure; an
impatient one gives up at once, for a caller with another provider to ask. A 401 or a
403 means the key or the account is wrong, which is a refusal.
"""

import time
from collections.abc import Callable, Sequence
from http import HTTPStatus
from importlib.metadata import version
from typing import Final, TypedDict

import requests
from pydantic import JsonValue

from medleyplay.plugin_api import AiEndpoint, AiFailureReason, NetworkError

USER_AGENT: Final = (
    f"medleyplay/{version('medleyplay')} ( https://github.com/pengzhengyi/medleyplay )"
)
TIMEOUT: Final = (10.0, 90.0)
"""How long, in seconds, one request may take to connect and to answer."""
MAX_TOKENS: Final = 16_384
"""The most the model may say: room for a song list of a few hundred songs, after a
reasoning model's thinking, which counts too."""
MAX_ATTEMPTS: Final = 3
"""How many times a request is sent while the provider is busy."""
MAX_WAIT: Final = 30.0
"""The longest `Retry-After`, in seconds, the client waits out; a longer one is a failure."""
DEFAULT_WAIT: Final = 5.0
"""How long to wait when the provider doesn't say."""

type Sleep = Callable[[float], None]


class Message(TypedDict):
    """One message of a chat: its role and its text."""

    role: str
    content: str


class RefusedError(Exception):
    """The provider refused the key or the account, so nothing more should be asked of it."""


class UnusableAnswerError(Exception):
    """The provider answered, but not with a reply the client can use: `reason` says why.

    `status` is the status of a request the provider refused.
    """

    def __init__(self, message: str, reason: AiFailureReason, status: int | None = None) -> None:
        """Say `message`, for `reason`."""
        super().__init__(message)
        self.reason = reason
        self.status = status


class BusyError(NetworkError):
    """The provider stayed busy or kept failing."""


class ChatClient:
    """Asks a provider's chat for one reply, waiting out a busy provider."""

    def __init__(
        self, session: requests.Session | None = None, *, sleep: Sleep = time.sleep
    ) -> None:
        """Create a client over `session`; `sleep` waits out a busy provider."""
        self._session = session or requests.Session()
        self._session.headers["User-Agent"] = USER_AGENT
        self._sleep = sleep

    def complete(
        self, endpoint: AiEndpoint, messages: Sequence[Message], *, patient: bool = True
    ) -> str:
        """Return what the model says in answer to `messages`, as text.

        Raise `RefusedError` for a key or an account the provider refuses,
        `UnusableAnswerError` for a reply that was cut off, empty, or no chat reply,
        `BusyError` for a provider that stays busy, or is busy once when not `patient`,
        and `NetworkError` for one that can't be reached.
        """
        body: dict[str, JsonValue] = {
            "model": endpoint.model,
            "messages": [{"role": each["role"], "content": each["content"]} for each in messages],
            "response_format": {"type": "json_object"},
            "temperature": 0,
            "max_tokens": MAX_TOKENS,
        }
        headers = {"Authorization": f"Bearer {endpoint.key}"} if endpoint.key else {}
        url = f"{endpoint.base_url.rstrip('/')}/chat/completions"
        attempts = MAX_ATTEMPTS if patient else 1
        for attempt in range(1, attempts + 1):
            response = self._post(url, body, headers)
            if not _is_busy(response):
                return _reply_of(response)
            self._wait_out(response, attempt, attempts)
        raise _too_busy()  # pragma: no cover -- the last attempt raises in `_wait_out`

    def _post(
        self, url: str, body: dict[str, JsonValue], headers: dict[str, str]
    ) -> requests.Response:
        try:
            # Redirects are not followed, so the key is sent to the address typed and no other.
            return self._session.post(
                url, json=body, headers=headers, timeout=TIMEOUT, allow_redirects=False
            )
        except requests.RequestException as error:
            # Only the kind of failure: the library's text can hold the address or the headers.
            message = f"The AI provider couldn't be reached: {type(error).__name__}."
            raise NetworkError(message) from None

    def _wait_out(self, response: requests.Response, attempt: int, attempts: int) -> None:
        wait = _retry_after(response)
        if wait > MAX_WAIT or attempt == attempts:
            raise _too_busy()
        self._sleep(wait)


def _is_busy(response: requests.Response) -> bool:
    status = response.status_code
    return status == HTTPStatus.TOO_MANY_REQUESTS or status >= HTTPStatus.INTERNAL_SERVER_ERROR


def _too_busy() -> BusyError:
    return BusyError("The AI provider was too busy to answer.")


def _retry_after(response: requests.Response) -> float:
    # A date is also allowed by HTTP; the default wait stands for it.
    try:
        return max(float(response.headers.get("Retry-After", "")), 0.0)
    except ValueError:
        return DEFAULT_WAIT


def _reply_of(response: requests.Response) -> str:
    status = response.status_code
    if status in {HTTPStatus.UNAUTHORIZED, HTTPStatus.FORBIDDEN}:
        message = f"The AI provider refused the key or the account ({status}). Check the key."
        raise RefusedError(message)
    if 300 <= status < 400:  # noqa: PLR2004 -- the range of redirects
        message = f"The AI provider answered with a redirect ({status}); check the base URL."
        raise UnusableAnswerError(message, AiFailureReason.REDIRECTED, status)
    if status >= HTTPStatus.BAD_REQUEST:
        message = f"The AI provider answered {status}; check the base URL and the model."
        raise UnusableAnswerError(message, AiFailureReason.REJECTED, status)
    try:
        answer: object = response.json()
    except requests.JSONDecodeError:
        # Such as a network's sign-in page, answering in the provider's place.
        message = "The answer was not the AI provider's: it was not JSON."
        raise NetworkError(message) from None
    return _content_of(answer)


def _content_of(answer: object) -> str:
    choice = _first_choice(answer)
    message = choice.get("message") if choice is not None else None
    content = message.get("content") if isinstance(message, dict) else None
    if choice is not None and choice.get("finish_reason") == "length":
        text = "The AI model ran out of room before it finished its answer."
        raise UnusableAnswerError(text, AiFailureReason.CUT_OFF)
    if not isinstance(content, str) or not content.strip():
        text = "The AI provider's answer was empty."
        raise UnusableAnswerError(text, AiFailureReason.EMPTY)
    return content


def _first_choice(answer: object) -> dict[str, object] | None:
    choices = answer.get("choices") if isinstance(answer, dict) else None
    first = choices[0] if isinstance(choices, list) and choices else None
    return first if isinstance(first, dict) else None
