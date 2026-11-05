"""An AI provider that answers from a table, with no socket opened.

The provider speaks the OpenAI chat protocol, so the fake is a `requests` transport
that answers `POST {base_url}/chat/completions` with what the test was told.
"""

import json
from typing import Any

from medleyplay.plugin_api import AiEndpoint
from tests.support.transport import FakeTransport, Reply

KEY = "sk-4f9a1c7e5b2d"
"""A key no test output may show."""
DEEPSEEK = "https://api.deepseek.com"
CHAT = f"{DEEPSEEK}/chat/completions"
"""Where the chat of the DeepSeek endpoint is asked."""


class AiEndpointFactory:
    """Builds the providers an enricher may be given."""

    @staticmethod
    def deepseek(*, key: str | None = KEY) -> AiEndpoint:
        """Return DeepSeek's `deepseek-flash`, with `key`."""
        return AiEndpoint(base_url=DEEPSEEK, model="deepseek-flash", key=key)

    @staticmethod
    def at(base_url: str, *, key: str | None = KEY) -> AiEndpoint:
        """Return a provider at `base_url`, asking the model `m`."""
        return AiEndpoint(base_url=base_url, model="m", key=key)

    @staticmethod
    def ollama() -> AiEndpoint:
        """Return a local Ollama, which needs no key."""
        return AiEndpoint(base_url="http://127.0.0.1:11434/v1", model="llama3.2")


class ChatReplyFactory:
    """Builds what a provider answers a chat request with."""

    @staticmethod
    def saying(content: str, *, finish_reason: str = "stop") -> Reply:
        """Return the answer in which the model says `content` and stops for `finish_reason`."""
        return Reply.json(
            {
                "id": "resp-1",
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": content},
                        "finish_reason": finish_reason,
                    }
                ],
            }
        )

    @staticmethod
    def json_saying(answer: dict[str, Any]) -> Reply:
        """Return the answer in which the model says `answer`, as JSON."""
        return ChatReplyFactory.saying(json.dumps(answer))

    @staticmethod
    def night_drive() -> Reply:
        """Return the answer for *Night Drive* by *Blue Room*, from the album *Re:Start*.

        ```json
        {"title": "Night Drive", "artist": "Blue Room", "album": "Re:Start", "year": 2016,
         "songs": null}
        ```
        """
        return ChatReplyFactory.json_saying(ChatAnswerFactory.night_drive())

    @staticmethod
    def album() -> Reply:
        """Return the answer for an album of three songs."""
        return ChatReplyFactory.json_saying(ChatAnswerFactory.album())


class ChatAnswerFactory:
    """Builds the JSON a model says."""

    @staticmethod
    def night_drive() -> dict[str, Any]:
        """Return the song *Night Drive* by *Blue Room* on *Re:Start*, from 2016."""
        return {
            "title": "Night Drive",
            "artist": "Blue Room",
            "album": "Re:Start",
            "year": 2016,
            "songs": None,
        }

    @staticmethod
    def album() -> dict[str, Any]:
        """Return the album *Re:Start* by *Blue Room*, of three songs."""
        return {
            "title": None,
            "artist": "Blue Room",
            "album": "Re:Start",
            "year": 2016,
            "songs": [
                {"start": "00:00", "title": "Intro", "artist": None},
                {"start": "03:12", "title": "Night Drive", "artist": "Blue Room"},
                {"start": "1:07:40", "title": "Outro", "artist": ""},
            ],
        }


class FakeAiFactory:
    """Builds fakes of the providers' chat endpoints."""

    @staticmethod
    def answering(*replies: Reply | Exception, url: str = CHAT) -> FakeTransport:
        """Return a fake that answers the chat at `url` with each of `replies`, then the last."""
        return FakeTransport().answer(url, *replies)
