"""A fake `requests` transport and a fake clock: nothing in a test opens a socket.

`FakeTransport` is what the client under test sends its real requests to: it answers
each from the replies it was given for that URL (query left out), then records what
was sent.
"""

import io
import json
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Self
from urllib.parse import parse_qs, urlsplit

import requests
from requests.adapters import BaseAdapter


@dataclass(frozen=True)
class Reply:
    """What the fake answers one request with."""

    status: int = 200
    headers: Mapping[str, str] | None = None
    body: bytes = b""

    @staticmethod
    def json(answer: object, status: int = 200) -> "Reply":
        """Return an answer holding `answer` as JSON."""
        return Reply(status, {"Content-Type": "application/json"}, json.dumps(answer).encode())

    @staticmethod
    def redirect(to: str) -> "Reply":
        """Return a redirect to `to`, as the Cover Art Archive answers."""
        return Reply(307, {"Location": to})


class FakeTransport(BaseAdapter):
    """Answers requests by URL, without the query, and keeps the requests it was sent."""

    def __init__(self) -> None:
        super().__init__()
        self._replies: dict[str, list[Reply | Exception]] = {}
        self.sent: list[requests.PreparedRequest] = []
        self.timeouts: list[object] = []

    def session(self) -> requests.Session:
        """Return a session whose every request goes to this fake."""
        session = requests.Session()
        session.mount("https://", self)
        session.mount("http://", self)
        return session

    def answer(self, url: str, *replies: Reply | Exception) -> Self:
        """Answer requests for `url` with each of `replies` in turn, then the last one again.

        A reply that is an exception is raised, as a connection that fails is.
        """
        self._replies[url] = list(replies)
        return self

    def send(
        self,
        request: requests.PreparedRequest,
        stream: bool = False,  # noqa: FBT001, FBT002 -- the signature `requests` calls
        timeout: Any = None,
        verify: Any = True,  # noqa: FBT002 -- the signature `requests` calls
        cert: Any = None,
        proxies: Any = None,
    ) -> requests.Response:
        self.sent.append(request)
        self.timeouts.append(timeout)
        url = (request.url or "").partition("?")[0]
        if url not in self._replies:
            message = f"The fake was not told how to answer {url}."
            raise AssertionError(message)
        replies = self._replies[url]
        reply = replies.pop(0) if len(replies) > 1 else replies[0]
        if isinstance(reply, Exception):
            raise reply
        response = requests.Response()
        response.status_code = reply.status
        response.headers.update(reply.headers or {})
        response.raw = io.BytesIO(reply.body)
        response.url = request.url or ""
        response.request = request
        return response

    def close(self) -> None:
        """Hold nothing open."""

    def urls(self) -> list[str]:
        """Return the URL of each request, query left out, in the order sent."""
        return [(each.url or "").partition("?")[0] for each in self.sent]

    def parameter(self, name: str, index: int = 0) -> str:
        """Return the query parameter `name` of the request number `index`, decoded."""
        return parse_qs(urlsplit(self.sent[index].url or "").query)[name][0]

    def body(self, index: int = 0) -> Any:
        """Return the JSON body of the request number `index`, parsed."""
        sent = self.sent[index].body
        return json.loads(sent if isinstance(sent, bytes | str) else b"")


class FakeWaits:
    """A clock and a sleep that agree: sleeping moves the clock, and nothing really waits."""

    def __init__(self) -> None:
        self.now = 100.0
        self.pauses: list[float] = []

    def clock(self) -> float:
        """Return the time now."""
        return self.now

    def sleep(self, seconds: float) -> None:
        """Move the time on by `seconds`, and remember the pause."""
        self.pauses.append(seconds)
        self.now += seconds

    def pass_time(self, seconds: float) -> None:
        """Move the time on without a pause, as work that takes time does."""
        self.now += seconds
