"""The events API: Server-Sent Events telling a browser of Jobs, the Mode, devices, remote play."""

import asyncio
import contextlib
from collections.abc import AsyncIterable, AsyncIterator
from typing import Annotated, Final

from fastapi import APIRouter, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.sse import EventSourceResponse, ServerSentEvent
from pydantic import BaseModel

from medleyplay.application.devices import Visit
from medleyplay.application.events import DEVICES, MODE, Event, SubscriptionEndedError
from medleyplay.application.remote import CommandsWaiting, PageId, ReportChanged
from medleyplay.domain.accounts import Account
from medleyplay.domain.devices import Verdict
from medleyplay.domain.errors import NotSignedInError
from medleyplay.web.deps import (
    AccountsDep,
    DevicesDep,
    DeviceToken,
    EventsDep,
    JobsDep,
    ModeDep,
    RemoteDep,
    SessionToken,
    SignedInAccount,
)
from medleyplay.web.devices import WaitingOut, visit_of
from medleyplay.web.jobs import JobOut
from medleyplay.web.mode import ModeOut
from medleyplay.web.remote import PAGE_PATTERN

router = APIRouter(prefix="/api", tags=["events"])

SESSION_CHECK_SECONDS: Final = 15.0
"""How often a stream checks its session is still signed in and its device still let in."""


class WaitingDevicesOut(BaseModel):
    """The devices waiting for an answer, oldest first."""

    waiting: list[WaitingOut]


class RemoteOut(BaseModel):
    """The account's speaker: its page, its last report, and how long ago that was; or none."""

    page: str | None
    state: dict[str, object] | None
    age_ms: int | None


@router.get("/events", response_class=EventSourceResponse)
async def stream_events(  # noqa: PLR0913 -- each service the stream tells of
    request: Request,
    *,
    me: SignedInAccount,
    events: EventsDep,
    jobs: JobsDep,
    mode: ModeDep,
    accounts: AccountsDep,
    devices: DevicesDep,
    remote: RemoteDep,
    page: Annotated[str | None, Query(pattern=PAGE_PATTERN)] = None,
    token: SessionToken = None,
    device: DeviceToken = None,
) -> AsyncIterable[ServerSentEvent]:
    """Stream a `job` event, the Job as `GET /api/jobs` shows it, whenever a Job changes.

    The stream starts with a `ready` event once it hears every change, so a
    browser asks `GET /api/jobs` after `ready` and misses nothing, then a `mode`
    event, the Mode as `GET /api/mode` shows it, sent again whenever the Mode
    changes. An admin's stream also has a `devices` event, the devices waiting
    for an answer, sent again whenever one starts waiting or is answered.
    Every stream has a `remote` event, the account's speaker as it last reported,
    sent again whenever it reports, comes, or goes. A stream opened with `page`
    names its page; while that page is the speaker, its stream has a `command`
    event for each command a remote sends, in order. Events carry no ids and
    nothing is replayed: a browser that reconnects waits for `ready` and asks
    again. The stream ends when its session does, as it does when its device is
    removed, or when its device is no longer let in.
    """
    loop = asyncio.get_running_loop()
    visit = visit_of(request, device)
    this_page = None if page is None else PageId(page)
    async with events.subscribe() as subscription, _open(remote, me, this_page):
        yield ServerSentEvent(event="ready", data={})
        yield ServerSentEvent(data=await _mode_out(mode, jobs), event="mode")
        if me.is_admin:
            yield ServerSentEvent(data=await _waiting_out(devices, me), event="devices")
        yield ServerSentEvent(data=_remote_out(remote, me), event="remote")
        checked = loop.time()
        while True:
            event: Event | None
            try:
                event = await asyncio.wait_for(subscription.next(), SESSION_CHECK_SECONDS)
            except TimeoutError:
                event = None
            except SubscriptionEndedError:
                return
            # Checked on a timer, so a busy stream ends with its session as a quiet one does.
            if loop.time() - checked >= SESSION_CHECK_SECONDS:
                still = await run_in_threadpool(_still_let_in, accounts, devices, token, visit)
                if still is None:
                    return
                me, checked = still, loop.time()
            sent = await _sent_for(event, me, jobs=jobs, mode=mode, devices=devices, remote=remote)
            if sent is not None:
                yield sent
            if this_page is not None:
                for command in remote.take_commands(me.id, this_page):
                    yield ServerSentEvent(data=command, event="command")


async def _sent_for(
    event: Event | None,
    me: Account,
    *,
    jobs: JobsDep,
    mode: ModeDep,
    devices: DevicesDep,
    remote: RemoteDep,
) -> ServerSentEvent | None:
    """Return what to send `me` for `event`; the waiting devices go to admins only.

    Remote play goes to the account's own streams; commands are taken apart.
    """
    if event is None or isinstance(event, CommandsWaiting):
        return None
    if isinstance(event, ReportChanged):
        if event.account != me.id:
            return None
        return ServerSentEvent(data=_remote_out(remote, me), event="remote")
    if event == MODE:
        return ServerSentEvent(data=await _mode_out(mode, jobs), event="mode")
    if event == DEVICES:
        return (
            ServerSentEvent(data=await _waiting_out(devices, me), event="devices")
            if me.is_admin
            else None
        )
    view = await run_in_threadpool(jobs.get_job, event)
    return ServerSentEvent(data=JobOut.of(view, me), event="job")


async def _mode_out(mode: ModeDep, jobs: JobsDep) -> ModeOut:
    return ModeOut.of(mode.now(), await run_in_threadpool(jobs.held_count))


@contextlib.asynccontextmanager
async def _open(remote: RemoteDep, me: Account, page: PageId | None) -> AsyncIterator[None]:
    """Count this stream as one of `page`'s while it is open."""
    if page is None:
        yield
        return
    remote.open(me.id, page)
    try:
        yield
    finally:
        remote.close(me.id, page)


def _remote_out(remote: RemoteDep, me: Account) -> RemoteOut:
    report = remote.report_of(me.id)
    if report is None:
        return RemoteOut(page=None, state=None, age_ms=None)
    return RemoteOut(
        page=report.page,
        state=dict(report.state),
        age_ms=round(report.age.total_seconds() * 1000),
    )


async def _waiting_out(devices: DevicesDep, me: Account) -> WaitingDevicesOut:
    view = await run_in_threadpool(devices.devices, me)
    return WaitingDevicesOut(waiting=[WaitingOut.of(w) for w in view.waiting])


def _still_let_in(
    accounts: AccountsDep, devices: DevicesDep, token: str | None, visit: Visit
) -> Account | None:
    """Return the stream's Account as it is now, or None if it or its device is no longer in."""
    if token is None:  # pragma: no cover -- the stream opened signed in
        return None
    if devices.admit(visit)[0] is not Verdict.ADMITTED:
        return None
    try:
        return accounts.authenticate(token)
    except NotSignedInError:
        return None
