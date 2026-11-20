"""Cached answers to the heaviest reads, and the lock their builds take turns on.

A heavy read builds its answer while holding one process-wide lock: SQLite hands
Python's interpreter lock back on every row, so builds side by side slow each other
down far more than taking turns does. The largest answers are also kept, as JSON and
gzip bytes, for as long as the database revision they were built under stands.
"""

import gzip
import hashlib
import threading
from collections.abc import Callable, Hashable, Iterator
from concurrent.futures import Future
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Final

from fastapi import Request, Response
from pydantic import TypeAdapter

from medleyplay.persistence.revision import DatabaseRevision

GZIP_LEVEL: Final = 6
NOT_MODIFIED: Final[dict[int | str, dict[str, object]]] = {
    304: {"description": "The request holds the current answer already; nothing is sent."}
}
CACHE_CONTROL: Final = "private, no-cache"

_heavy = threading.Lock()
_holding = threading.local()

type AnswerKey = tuple[Hashable, ...]


class HeavyReadReenteredError(RuntimeError):
    """A heavy read was started while the same thread was building another."""


@contextmanager
def heavy_read() -> Iterator[None]:
    """Hold the heavy-read lock while building an answer, waiting for any build under way.

    A build that starts another heavy read raises at once rather than waiting on itself.
    """
    if getattr(_holding, "held", False):
        message = "A heavy read was started inside another; build it outside the first."
        raise HeavyReadReenteredError(message)
    with _heavy:
        _holding.held = True
        try:
            yield
        finally:
            _holding.held = False


@dataclass(frozen=True)
class CachedAnswer:
    """An answer's bytes, plain and gzipped, and the revision and ETag they were built under."""

    revision: int
    etag: str
    plain: bytes
    gzipped: bytes


class CachedAnswers:
    """One answer per key, built once per database revision and sent as it was kept.

    A key names what the answer depends on beyond the database, such as the Account
    asking. An answer is labeled with the revision read before its build, so it is
    never labeled newer than the rows it holds.
    """

    def __init__(self, revision: DatabaseRevision) -> None:
        """Keep answers that stand while `revision` does."""
        self._revision = revision
        self._lock = threading.Lock()
        self._answers: dict[AnswerKey, CachedAnswer] = {}
        self._building: dict[tuple[AnswerKey, int], Future[CachedAnswer]] = {}

    def etag(self, key: AnswerKey, revision: int) -> str:
        """Return the weak ETag of the answer for `key` under `revision`, on this server."""
        named = f"{self._revision.mark}:{revision}:{key!r}"
        return f'W/"{hashlib.sha256(named.encode()).hexdigest()[:24]}"'

    def get[T](
        self, key: AnswerKey, build: Callable[[], T], adapter: TypeAdapter[T]
    ) -> CachedAnswer:
        """Return the answer for `key` under the current revision, building it if none is kept.

        A request that finds the answer being built waits for that build, outside the
        heavy-read lock, and gets the same answer or the same error.
        """
        revision = self._revision.value
        with self._lock:
            kept = self._answers.get(key)
            if kept is not None and kept.revision == revision:
                return kept
            pending = self._building.get((key, revision))
            builds = pending is None
            if pending is None:
                pending = self._building[key, revision] = Future()
        if not builds:
            return pending.result()
        try:
            answer = self._build(key, revision, build, adapter)
        except BaseException as error:
            with self._lock:
                del self._building[key, revision]
            pending.set_exception(error)
            raise
        with self._lock:
            del self._building[key, revision]
            kept = self._answers.get(key)
            if kept is None or kept.revision <= revision:
                self._answers[key] = answer
        pending.set_result(answer)
        return answer

    def answer[T](
        self, request: Request, key: AnswerKey, build: Callable[[], T], adapter: TypeAdapter[T]
    ) -> Response:
        """Answer `request` with 304 when it holds the current answer, else with its bytes.

        A 304 builds nothing. The bytes are gzipped when the request accepts gzip.
        """
        current = self.etag(key, self._revision.value)
        if _matches(request.headers.get("if-none-match"), current):
            return Response(status_code=304, headers=_headers(current))
        answer = self.get(key, build, adapter)
        headers = _headers(answer.etag)
        if _accepts_gzip(request.headers.get("accept-encoding")):
            headers["Content-Encoding"] = "gzip"
            return Response(answer.gzipped, media_type="application/json", headers=headers)
        return Response(answer.plain, media_type="application/json", headers=headers)

    def _build[T](
        self, key: AnswerKey, revision: int, build: Callable[[], T], adapter: TypeAdapter[T]
    ) -> CachedAnswer:
        with heavy_read():
            # As FastAPI serializes a response model, so the bytes are the same.
            plain = adapter.dump_json(build(), by_alias=True)
        return CachedAnswer(
            revision, self.etag(key, revision), plain, gzip.compress(plain, GZIP_LEVEL)
        )


def _headers(etag: str) -> dict[str, str]:
    return {"ETag": etag, "Cache-Control": CACHE_CONTROL, "Vary": "Accept-Encoding"}


def _matches(if_none_match: str | None, etag: str) -> bool:
    """Return whether `If-None-Match` holds `etag`, compared weakly, or is `*`."""
    if if_none_match is None:
        return False
    wanted = etag.removeprefix("W/")
    for tag in if_none_match.split(","):
        held = tag.strip()
        if held == "*" or held.removeprefix("W/") == wanted:
            return True
    return False


def _accepts_gzip(accept_encoding: str | None) -> bool:
    """Return whether `Accept-Encoding` lists gzip without refusing it with `q=0`."""
    for coding in (accept_encoding or "").split(","):
        name, _, parameters = coding.partition(";")
        if name.strip().lower() in {"gzip", "*"}:
            quality = parameters.strip().removeprefix("q=").strip()
            try:
                return not quality or float(quality) > 0
            except ValueError:
                return False
    return False
