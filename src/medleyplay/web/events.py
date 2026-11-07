"""The events API: Server-Sent Events telling a browser when a Job, the Mode, or devices change."""

import asyncio
from collections.abc import AsyncIterable
from typing import Final

from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool
from fastapi.sse import EventSourceResponse, ServerSentEvent
from pydantic import BaseModel

from medleyplay.application.events import DEVICES, MODE, Event, SubscriptionEndedError
from medleyplay.domain.accounts import Account
from medleyplay.domain.errors import NotSignedInError
from medleyplay.web.deps import (
    AccountsDep,
    DevicesDep,
    EventsDep,
    JobsDep,
    ModeDep,
    SessionToken,
    SignedInAccount,
)
from medleyplay.web.devices import WaitingOut
from medleyplay.web.jobs import JobOut
from medleyplay.web.mode import ModeOut

router = APIRouter(prefix="/api", tags=["events"])

SESSION_CHECK_SECONDS: Final = 15.0
"""How often a stream checks its session is still signed in."""


class WaitingDevicesOut(BaseModel):
    """The devices waiting for an answer, oldest first."""

    waiting: list[WaitingOut]


@router.get("/events", response_class=EventSourceResponse)
async def stream_events(
    me: SignedInAccount,
    events: EventsDep,
    jobs: JobsDep,
    mode: ModeDep,
    accounts: AccountsDep,
    devices: DevicesDep,
    token: SessionToken = None,
) -> AsyncIterable[ServerSentEvent]:
    """Stream a `job` event, the Job as `GET /api/jobs` shows it, whenever a Job changes.

    The stream starts with a `ready` event once it hears every change, so a
    browser asks `GET /api/jobs` after `ready` and misses nothing, then a `mode`
    event, the Mode as `GET /api/mode` shows it, sent again whenever the Mode
    changes. An admin's stream also has a `devices` event, the devices waiting
    for an answer, sent again whenever one starts waiting or is answered.
    Events carry no ids and nothing is replayed: a browser that reconnects waits
    for `ready` and asks again. The stream ends when its session does, as it does
    when its device is removed.
    """
    loop = asyncio.get_running_loop()
    async with events.subscribe() as subscription:
        yield ServerSentEvent(event="ready", data={})
        yield ServerSentEvent(data=await _mode_out(mode, jobs), event="mode")
        if me.is_admin:
            yield ServerSentEvent(data=_waiting_out(devices, me), event="devices")
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
                if not await run_in_threadpool(_still_signed_in, accounts, token):
                    return
                checked = loop.time()
            sent = await _sent_for(event, me, jobs=jobs, mode=mode, devices=devices)
            if sent is not None:
                yield sent


async def _sent_for(
    event: Event | None, me: Account, *, jobs: JobsDep, mode: ModeDep, devices: DevicesDep
) -> ServerSentEvent | None:
    """Return what to send `me` for `event`; the waiting devices go to admins only."""
    if event is None:
        return None
    if event == MODE:
        return ServerSentEvent(data=await _mode_out(mode, jobs), event="mode")
    if event == DEVICES:
        return (
            ServerSentEvent(data=_waiting_out(devices, me), event="devices")
            if me.is_admin
            else None
        )
    view = await run_in_threadpool(jobs.get_job, event)
    return ServerSentEvent(data=JobOut.of(view), event="job")


async def _mode_out(mode: ModeDep, jobs: JobsDep) -> ModeOut:
    return ModeOut.of(mode.now(), await run_in_threadpool(jobs.held_count))


def _waiting_out(devices: DevicesDep, me: Account) -> WaitingDevicesOut:
    return WaitingDevicesOut(waiting=[WaitingOut.of(w) for w in devices.devices(me).waiting])


def _still_signed_in(accounts: AccountsDep, token: str | None) -> bool:
    if token is None:  # pragma: no cover -- the stream opened signed in
        return False
    try:
        accounts.authenticate(token)
    except NotSignedInError:
        return False
    return True
