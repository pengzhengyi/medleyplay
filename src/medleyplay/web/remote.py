"""The remote play API: the speaker on the host reports what it plays, and remotes send commands.

A page names itself with a random `page` id. The speaker's reports and the
remotes' commands reach the account's event streams as `remote` and `command`
events (see the events API).
"""

from typing import Annotated, Final, Literal, Self

from fastapi import APIRouter, Request, Response, status
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from medleyplay.application.remote import PageId
from medleyplay.domain.errors import ForbiddenError
from medleyplay.web.deps import RemoteDep, SignedInAccount
from medleyplay.web.devices import visit_of

router = APIRouter(prefix="/api/remote", tags=["remote"])

MAX_REPORTED_ENTRIES: Final = 500
"""The most of the queue a report carries, from a little before the entry playing."""
MAX_QUEUED: Final = 20_000
"""The most entries a command may queue."""
PAGE_PATTERN: Final = r"^[A-Za-z0-9_-]{8,64}$"

type Page = Annotated[str, StringConstraints(pattern=PAGE_PATTERN)]
type Key = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{1,64}$")]
type Unit = Annotated[str, StringConstraints(max_length=128)]
type TrackId = Annotated[int, Field(ge=1)]
type Seconds = Annotated[float, Field(ge=0, le=1_000_000)]
type Repeat = Literal["off", "all", "one"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class EntryIn(_Strict):
    """One entry of a queue: its key, its Track, and the unit it is part of."""

    key: Key
    track_id: TrackId
    unit: Unit | None = None


class QueuedIn(_Strict):
    """A Track to queue, and the unit it is part of."""

    track_id: TrackId
    unit: Unit | None = None


class SleepIn(_Strict):
    """The speaker's sleep timer: how long until it pauses, and since it was set."""

    left_ms: Annotated[int, Field(ge=0)]
    set_ms_ago: Annotated[int, Field(ge=0)]


class ReportIn(_Strict):
    """What the speaker plays: a window of its queue in the order it plays, and how it plays.

    `entries` starts at place `offset` of the `total`; `position` is the place
    of the entry playing, `total` when the queue has finished. `counted` says
    whether the play of that entry has been counted.
    """

    page: Page
    entries: Annotated[list[EntryIn], Field(max_length=MAX_REPORTED_ENTRIES)]
    offset: Annotated[int, Field(ge=0)]
    total: Annotated[int, Field(ge=0, le=MAX_QUEUED * 10)]
    position: Annotated[int, Field(ge=0)]
    status: Literal["idle", "loading", "preparing", "playing", "paused", "blocked", "failed"]
    message: Annotated[str, StringConstraints(max_length=300)] | None = None
    shuffled: bool
    repeat: Repeat
    seconds: Seconds
    duration: Seconds | None
    volume: Annotated[float, Field(ge=0, le=1)]
    muted: bool
    counted: bool = False
    sleep: SleepIn | None = None


class SpeakerOut(BaseModel):
    """Whether the page that reported is the speaker."""

    speaker: bool


class _Command(_Strict):
    pass


class PlayIn(_Command):
    """Play `entries` from place `start`."""

    kind: Literal["play"]
    entries: Annotated[list[QueuedIn], Field(min_length=1, max_length=MAX_QUEUED)]
    start: Annotated[int, Field(ge=0)]


class PlayAllIn(_Command):
    """Play every one of `entries` from the first, in order or shuffled."""

    kind: Literal["playAll"]
    entries: Annotated[list[QueuedIn], Field(min_length=1, max_length=MAX_QUEUED)]
    shuffled: bool


class QueueOneIn(_Command):
    """Play a Track next, or add it at the end."""

    kind: Literal["playNext", "add"]
    entry: QueuedIn


class TransportIn(_Command):
    """Play or pause, pause, or go to the next or the previous entry."""

    kind: Literal["toggle", "pause", "next", "previous", "clear"]


class SeekIn(_Command):
    """Go to `seconds` into the entry `key`; nothing if another plays by then."""

    kind: Literal["seek"]
    key: Key
    seconds: Seconds


class MoveIn(_Command):
    """Move the upcoming entry `key` to place `to` among what plays next."""

    kind: Literal["move"]
    key: Key
    to: Annotated[int, Field(ge=0)]


class RemoveIn(_Command):
    """Take the entry `key` out of the queue."""

    kind: Literal["remove"]
    key: Key


class ShuffleIn(_Command):
    """Shuffle what plays next, or play it in order again."""

    kind: Literal["shuffle"]
    on: bool


class RepeatIn(_Command):
    """What plays after the last entry, and when a Track ends."""

    kind: Literal["repeat"]
    repeat: Repeat


class VolumeIn(_Command):
    """How loud the speaker plays, which also turns the sound back on."""

    kind: Literal["volume"]
    volume: Annotated[float, Field(ge=0, le=1)]


class MuteIn(_Command):
    """Silence the speaker for now, or turn its sound back on."""

    kind: Literal["mute"]
    muted: bool


class SleepCommandIn(_Command):
    """Pause the speaker `minutes` from now, or turn its sleep timer off with None."""

    kind: Literal["sleep"]
    minutes: Annotated[int, Field(ge=1, le=24 * 60)] | None


class TakeIn(_Command):
    """Play this queue on the speaker from `seconds` into the entry at `position`.

    `entries` are in the order they play; while shuffled, `order` is the queue's
    own order of their keys. `counted` says whether the play of the entry at
    `position` has already been counted.
    """

    kind: Literal["take"]
    entries: Annotated[list[EntryIn], Field(min_length=1, max_length=MAX_QUEUED)]
    order: Annotated[list[Key], Field(max_length=MAX_QUEUED)] | None = None
    position: Annotated[int, Field(ge=0)]
    repeat: Repeat
    shuffled: bool
    seconds: Seconds
    playing: bool
    counted: bool

    @model_validator(mode="after")
    def _one_queue(self) -> Self:
        keys = [entry.key for entry in self.entries]
        if len(set(keys)) != len(keys):
            message = "Each entry needs a key of its own."
            raise ValueError(message)
        if self.position >= len(keys):
            message = "The position must name one of the entries."
            raise ValueError(message)
        if self.order is not None and sorted(self.order) != sorted(keys):
            message = "The order must name each entry once."
            raise ValueError(message)
        return self


type CommandIn = Annotated[
    PlayIn
    | PlayAllIn
    | QueueOneIn
    | TransportIn
    | SeekIn
    | MoveIn
    | RemoveIn
    | ShuffleIn
    | RepeatIn
    | VolumeIn
    | MuteIn
    | SleepCommandIn
    | TakeIn,
    Field(discriminator="kind"),
]


class CommandBody(_Strict):
    """A command for the account's speaker."""

    command: CommandIn


@router.put("/report")
def report(body: ReportIn, request: Request, me: SignedInAccount, remote: RemoteDep) -> SpeakerOut:
    """Take what a page on the host plays; return whether it is the account's speaker.

    A host page becomes the speaker by reporting while it plays, or while it has
    a queue and the account has none. A page elsewhere is refused.
    """
    if not visit_of(request, None).host:
        message = "Only a page on the computer medleyplay runs on can play for the household."
        raise ForbiddenError(message)
    state = body.model_dump(mode="json", exclude={"page"})
    speaker = remote.report(
        me.id, PageId(body.page), state, playing=body.status == "playing", queued=body.total > 0
    )
    return SpeakerOut(speaker=speaker)


@router.post("/commands", status_code=status.HTTP_204_NO_CONTENT)
def command(body: CommandBody, me: SignedInAccount, remote: RemoteDep) -> Response:
    """Pass a command to the account's speaker; with none, 409; with too many waiting, 429."""
    remote.command(me.id, body.command.model_dump(mode="json"))
    return Response(status_code=status.HTTP_204_NO_CONTENT)
