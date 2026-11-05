"""A MusicBrainz and a Cover Art Archive that answer from a table, with no socket opened.

`FakeMusicBrainz` is a `requests` transport: the client under test sends its real
requests, and the fake answers each from the replies it was given for that URL (query
left out), then records what was sent.
"""

import io
import json
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qs, urlsplit

import requests
from requests.adapters import BaseAdapter

from tests.support.images import jpeg_image
from tests.support.recordings import recorded_answer

API = "https://musicbrainz.org/ws/2"
COVERS = "https://coverartarchive.org"
ORIGINAL = "1834eae1-741b-3c03-9ca5-0df3decb43ea"
"""The earliest release of *OK Computer* the recorded search lists: Japan, 1997-05-21."""
REISSUE = "d339ba4d-0e44-4d2d-bc7a-b8078c072da9"
"""The 2016 reissue of *OK Computer*, which the recorded release lookup describes."""
LET_DOWN = "47b02a82-c3bf-4647-b894-dd1c8f608e7f"
"""The recording of *Let Down* the recorded search scores 100."""
SHU_PU = "0f463449-2b8b-4874-88ed-92392d97f955"
"""The 2003 original of 朴树's 生如夏花 in the hand-made answers."""


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


class FakeMusicBrainz(BaseAdapter):
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

    def answer(self, url: str, *replies: Reply | Exception) -> "FakeMusicBrainz":
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


class MusicBrainzFactory:
    """Builds the answers of MusicBrainz and the sites it points to, from the recordings."""

    @staticmethod
    def let_down_search(*, score: int | None = None) -> dict[str, Any]:
        """Return the recorded recording search for *Let Down* by *Radiohead*.

        Its best recording, scoring 100, is on 55 releases, among them the 1997
        originals and the 2016 reissue; its second, *Let Down (Thom 4track)*, scores 92
        and is 176 seconds long. With `score`, every recording scores that instead.
        """
        answer = recorded_answer("latin-search")
        if score is not None:
            for recording in answer["recordings"]:
                recording["score"] = score
        return answer

    @staticmethod
    def ok_computer(
        release: str = ORIGINAL, *, date: str = "1997-05-21", front: bool = True
    ) -> dict[str, Any]:
        """Return the recorded lookup of *OK Computer*, as the release `release` of `date`.

        The recording is the 2016 reissue's, which says it has no front cover; here its
        id and date are those of `release`, and `front` says whether it has one.
        """
        answer = recorded_answer("latin-release")
        answer.update(id=release, date=date)
        answer["cover-art-archive"] = {"front": front, "back": False, "count": int(front)}
        return answer

    @staticmethod
    def shu_pu_search() -> dict[str, Any]:
        """Return the hand-made release search for 生如夏花 by 朴树."""
        return recorded_answer("cjk-release-search")

    @staticmethod
    def shu_pu_release(*, front: bool = True) -> dict[str, Any]:
        """Return the hand-made lookup of 生如夏花, with 11 songs."""
        answer = recorded_answer("cjk-release")
        answer["cover-art-archive"] = {"front": front, "back": False, "count": int(front)}
        return answer


class FakeMusicBrainzFactory:
    """Builds a fake that knows the sites' answers for a song and for an album."""

    @staticmethod
    def knowing_let_down(*, front: bool = True, image: bytes | None = None) -> FakeMusicBrainz:
        """Return a fake that finds *Let Down* on its original release, with a cover.

        ```text
        /recording             the recorded search
        /release/1834eae1…     OK Computer, 1997-05-21
        /release/1834eae1…/front-500   a redirect to archive.org, which holds a JPEG
        ```
        """
        picture = jpeg_image("OK Computer") if image is None else image
        return (
            FakeMusicBrainz()
            .answer(f"{API}/recording", Reply.json(MusicBrainzFactory.let_down_search()))
            .answer(
                f"{API}/release/{ORIGINAL}", Reply.json(MusicBrainzFactory.ok_computer(front=front))
            )
            .answer(
                f"{COVERS}/release/{ORIGINAL}/front-500",
                Reply.redirect("https://archive.org/cover.jpg"),
            )
            .answer("https://archive.org/cover.jpg", Reply(200, {}, picture))
        )

    @staticmethod
    def knowing_shu_pu() -> FakeMusicBrainz:
        """Return a fake that finds the album 生如夏花 by 朴树 on its 2003 original."""
        return (
            FakeMusicBrainz()
            .answer(f"{API}/release", Reply.json(MusicBrainzFactory.shu_pu_search()))
            .answer(f"{API}/release/{SHU_PU}", Reply.json(MusicBrainzFactory.shu_pu_release()))
            .answer(
                f"{COVERS}/release/{SHU_PU}/front-500",
                Reply.redirect("https://archive.org/shu-pu.jpg"),
            )
            .answer("https://archive.org/shu-pu.jpg", Reply(200, {}, jpeg_image("生如夏花")))
        )
