"""Remote play: a page on the host plays for its account, and the account's other pages control it.

The speaker is the medleyplay page on the host that plays aloud. It reports what
it plays whenever that changes; a remote, another page of the same account,
shows the report and sends commands, which wait here until the speaker's event
stream takes them. Everything is in memory: after a restart the speaker reports
again when its stream comes back.

```text
remote ──command──> RemoteService ──CommandsWaiting──> speaker's stream ──> speaker
speaker ──report──> RemoteService ──ReportChanged──> each of the account's streams
```

A host page becomes the speaker by reporting while it plays, or while it has a
queue and the account has no speaker, so the page the household used last
answers. A page is the speaker only while one of its event streams is open, so
a stream that reconnects keeps it.

Reports and commands are JSON objects the web layer has checked; this service
never looks inside them.
"""

import logging
import threading
from collections import deque
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Final, NewType

from medleyplay.application import Clock
from medleyplay.domain.accounts import AccountId
from medleyplay.domain.errors import BusyError, ConflictError

MAX_WAITING_COMMANDS: Final = 64
"""How many commands may wait for a speaker; one more is refused until it takes them."""
_log = logging.getLogger(__name__)

PageId = NewType("PageId", str)
"""A random name a page gives itself when it loads."""
type Json = Mapping[str, object]


@dataclass(frozen=True)
class ReportChanged:
    """An account's speaker came, went, or reported."""

    account: AccountId


@dataclass(frozen=True)
class CommandsWaiting:
    """Commands wait for the speaker `page` of an account."""

    account: AccountId
    page: PageId


type RemoteEvent = ReportChanged | CommandsWaiting


@dataclass(frozen=True)
class Report:
    """An account's speaker: its page, and what it last reported, `age` ago."""

    page: PageId
    state: Json
    age: timedelta


@dataclass
class _Speaker:
    page: PageId
    state: Json
    at: datetime
    commands: deque[Json] = field(default_factory=deque)


class RemoteService:
    """Each account's speaker, its last report, and the commands waiting for it."""

    def __init__(self, clock: Clock) -> None:
        """Create the service, with no speakers."""
        self._clock = clock
        self._lock = threading.Lock()
        self._speakers: dict[AccountId, _Speaker] = {}
        self._streams: dict[tuple[AccountId, PageId], int] = {}
        """How many event streams each page has open."""
        self._listeners: list[Callable[[RemoteEvent], None]] = []

    def listen(self, listener: Callable[[RemoteEvent], None]) -> None:
        """Call `listener` with each event, on the thread that caused it."""
        with self._lock:
            self._listeners.append(listener)

    def open(self, account: AccountId, page: PageId) -> None:
        """Note an event stream of `page` opened."""
        with self._lock:
            self._streams[account, page] = self._streams.get((account, page), 0) + 1

    def close(self, account: AccountId, page: PageId) -> None:
        """Note an event stream of `page` ended; a speaker with no stream left is forgotten."""
        with self._lock:
            left = self._streams.get((account, page), 0) - 1
            if left > 0:
                self._streams[account, page] = left
                return
            self._streams.pop((account, page), None)
            speaker = self._speakers.get(account)
            if speaker is None or speaker.page != page:
                return
            del self._speakers[account]
        self._tell(ReportChanged(account))

    def report(
        self, account: AccountId, page: PageId, state: Json, *, playing: bool, queued: bool
    ) -> bool:
        """Take a host page's report, and return whether that page is the speaker.

        A page becomes the speaker by reporting while it plays, or while it has
        a queue and the account has no speaker; otherwise its report is
        ignored. Only a page on the host may report; the web layer checks that.
        """
        with self._lock:
            if (account, page) not in self._streams:
                return False
            speaker = self._speakers.get(account)
            if speaker is not None and speaker.page == page:
                speaker.state, speaker.at = state, self._clock()
            elif playing or (speaker is None and queued):
                self._speakers[account] = _Speaker(page, state, self._clock())
            else:
                return False
        self._tell(ReportChanged(account))
        return True

    def report_of(self, account: AccountId) -> Report | None:
        """Return the account's speaker as it last reported, or None if it has none."""
        with self._lock:
            speaker = self._speakers.get(account)
            if speaker is None:
                return None
            return Report(speaker.page, speaker.state, self._clock() - speaker.at)

    def command(self, account: AccountId, command: Json) -> None:
        """Pass `command` to the account's speaker; with none, conflict.

        A full line of commands is refused, busy, until the speaker takes them.
        """
        with self._lock:
            speaker = self._speakers.get(account)
            if speaker is None:
                message = "Nothing is playing on the computer; open medleyplay there."
                raise ConflictError(message)
            if len(speaker.commands) >= MAX_WAITING_COMMANDS:
                message = "The computer hasn't caught up yet; try again in a moment."
                raise BusyError(message)
            speaker.commands.append(command)
        self._tell(CommandsWaiting(account, speaker.page))

    def take_commands(self, account: AccountId, page: PageId) -> list[Json]:
        """Return and forget the commands waiting for `page`, if it is the account's speaker."""
        with self._lock:
            speaker = self._speakers.get(account)
            if speaker is None or speaker.page != page:
                return []
            taken = list(speaker.commands)
            speaker.commands.clear()
            return taken

    def _tell(self, event: RemoteEvent) -> None:
        with self._lock:
            listeners = tuple(self._listeners)
        for listener in listeners:
            try:
                listener(event)
            except Exception:  # noqa: BLE001 -- one listener's failure mustn't keep the rest from hearing
                _log.exception("A listener to remote play failed")
