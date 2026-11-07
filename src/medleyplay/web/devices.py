"""The devices API, and the check that admits each request before anything else answers it.

A request under `/api`, or for the API's description, from a device the
household hasn't let in is refused with `403`, code `device_waiting` or
`device_refused`; `GET /api/device`, where a device asks, and the web client's
files answer it still.
"""

from collections.abc import Awaitable, Callable
from datetime import datetime
from typing import Annotated, Final

from fastapi import APIRouter, Path, Request, Response, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from medleyplay.application.devices import (
    Asked,
    DevicesView,
    Presence,
    Visit,
    Waiting,
)
from medleyplay.domain.devices import Admission, Device, DeviceId, Verdict, is_host
from medleyplay.web.deps import (
    DEVICE_COOKIE,
    DevicesDep,
    DeviceToken,
    SessionToken,
    SignedInAccount,
    ThisDevice,
    services_of,
)

router = APIRouter(prefix="/api", tags=["devices"])

DEVICE_COOKIE_DAYS: Final = 400
"""The longest a browser keeps a cookie."""
ASK_PATH: Final = "/api/device"
_DESCRIPTION_PATHS: Final = frozenset({"/openapi.json", "/docs", "/docs/oauth2-redirect", "/redoc"})
"""FastAPI's description of the API, which shows a device what it could ask."""
_FORWARDING_HEADERS: Final = (
    "forwarded",
    "x-forwarded-for",
    "x-forwarded-host",
    "x-forwarded-proto",
    "x-real-ip",
    "via",
    "cf-connecting-ip",
    "true-client-ip",
)
"""Headers a proxy adds; a request carrying one came through a proxy, so isn't the host's."""
_REFUSALS: Final = {
    Verdict.WAITING: (
        "device_waiting",
        "This device is waiting for approval; an admin allows it on the host.",
    ),
    Verdict.REFUSED: ("device_refused", "This device can't connect to medleyplay."),
}

type DeviceIdPath = Annotated[str, Path(pattern=r"^[0-9a-f]{16}$")]


class DeviceOut(BaseModel):
    """What this device is to the server; `code` is shown while it waits."""

    presence: Presence
    label: str
    code: str | None


class WaitingOut(BaseModel):
    """A device waiting for an answer, with the code it shows."""

    id: str
    label: str
    address: str
    code: str
    since: datetime

    @classmethod
    def of(cls, waiting: Waiting) -> "WaitingOut":
        """Return the API view of a waiting device."""
        return cls(
            id=waiting.id,
            label=waiting.label,
            address=waiting.address,
            code=waiting.code,
            since=waiting.since,
        )


class AllowedOut(BaseModel):
    """An allowed device; `this_device` marks the one making the request."""

    id: str
    label: str
    address: str
    allowed_at: datetime
    last_seen_at: datetime
    this_device: bool

    @classmethod
    def of(cls, device: Device, this_device: DeviceId | None) -> "AllowedOut":
        """Return the API view of an allowed device."""
        return cls(
            id=device.id,
            label=device.label,
            address=device.address,
            allowed_at=device.allowed_at,
            last_seen_at=device.last_seen_at,
            this_device=device.id == this_device,
        )


class DevicesOut(BaseModel):
    """The choice for new devices, its revision, and the waiting and allowed devices."""

    admission: Admission
    revision: int
    waiting: list[WaitingOut]
    allowed: list[AllowedOut]

    @classmethod
    def of(cls, view: DevicesView, this_device: DeviceId | None) -> "DevicesOut":
        """Return the API view of the devices."""
        return cls(
            admission=view.admission,
            revision=view.revision,
            waiting=[WaitingOut.of(w) for w in view.waiting],
            allowed=[AllowedOut.of(d, this_device) for d in view.allowed],
        )


class AdmissionIn(BaseModel):
    """The choice to save, and the revision it was read at; 0 if never saved."""

    admission: Admission
    revision: int = Field(ge=0)


def visit_of(request: Request, token: str | None) -> Visit:
    """Return the request as the device check sees it."""
    peer = "" if request.client is None else request.client.host
    server = request.scope.get("server")
    local = "" if not server else str(server[0])
    forwarded = any(header in request.headers for header in _FORWARDING_HEADERS)
    return Visit(token=token, address=peer, host=is_host(peer, local, forwarded=forwarded))


async def admit_devices(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    """Refuse a request under `/api` from a device not let in; note the device it comes from."""
    request.state.device_id = None
    if not _checked(request.url.path):
        return await call_next(request)
    devices = services_of(request).devices
    visit = visit_of(request, request.cookies.get(DEVICE_COOKIE))
    verdict, device_id = await run_in_threadpool(devices.admit, visit)
    refusal = _REFUSALS.get(verdict)
    if refusal is not None:
        code, detail = refusal
        return JSONResponse({"detail": detail, "code": code}, status_code=status.HTTP_403_FORBIDDEN)
    request.state.device_id = device_id
    return await call_next(request)


def _checked(path: str) -> bool:
    if path == ASK_PATH:
        return False
    return path == "/api" or path.startswith("/api/") or path in _DESCRIPTION_PATHS


def give_cookie(response: Response, asked: Asked) -> None:
    """Give the device the cookie `asked` holds, if it holds one."""
    if asked.token is not None:
        # Plain HTTP on the LAN, so the cookie can't be `Secure`.
        response.set_cookie(
            DEVICE_COOKIE,
            asked.token,
            max_age=DEVICE_COOKIE_DAYS * 24 * 60 * 60,
            httponly=True,
            samesite="lax",
        )


@router.get("/device")
def ask(
    request: Request,
    response: Response,
    devices: DevicesDep,
    token: DeviceToken = None,
    session: SessionToken = None,
) -> DeviceOut:
    """Return what this device is: the host, allowed, admitted, waiting, or refused.

    A new device is given its cookie here, and waits with a code while the
    household asks first.
    """
    asked = devices.ask(
        visit_of(request, token), request.headers.get("user-agent", ""), session_token=session
    )
    give_cookie(response, asked)
    return DeviceOut(presence=asked.presence, label=asked.label, code=asked.code)


@router.get("/devices")
def list_devices(me: SignedInAccount, devices: DevicesDep, this: ThisDevice) -> DevicesOut:
    """Return the choice for new devices and the waiting and allowed devices; admins only."""
    return DevicesOut.of(devices.devices(me), this)


@router.put("/devices/setting")
def put_admission(  # noqa: PLR0913 -- the change, and the device making it
    body: AdmissionIn,
    request: Request,
    response: Response,
    *,
    me: SignedInAccount,
    devices: DevicesDep,
    this: ThisDevice,
    token: DeviceToken = None,
    session: SessionToken = None,
) -> DevicesOut:
    """Change the choice read at `revision`; a stale revision answers 409. Admins only.

    Leaving Allow all from a device not yet allowed allows it, giving it its
    cookie, so the change doesn't shut it out.
    """
    saved = devices.put_admission(
        me,
        body.admission,
        body.revision,
        this=visit_of(request, token),
        user_agent=request.headers.get("user-agent", ""),
        session_token=session,
    )
    if saved.allowed is None:
        return DevicesOut.of(saved.view, this)
    give_cookie(response, saved.allowed)
    return DevicesOut.of(saved.view, saved.allowed.device_id)


@router.post("/devices/{device_id}/allow")
def allow(
    device_id: DeviceIdPath, me: SignedInAccount, devices: DevicesDep, this: ThisDevice
) -> AllowedOut:
    """Allow a waiting device; one no longer waiting answers 404. Admins only."""
    return AllowedOut.of(devices.allow(me, DeviceId(device_id)), this)


@router.post("/devices/{device_id}/turn-away", status_code=status.HTTP_204_NO_CONTENT)
def turn_away(device_id: DeviceIdPath, me: SignedInAccount, devices: DevicesDep) -> Response:
    """Refuse a waiting device for a day; one no longer waiting answers 404. Admins only."""
    devices.turn_away(me, DeviceId(device_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/devices/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove(
    device_id: DeviceIdPath, me: SignedInAccount, devices: DevicesDep, this: ThisDevice
) -> Response:
    """Remove an allowed device, ending its sessions; admins only.

    This device answers 409; one already gone answers 204 too.
    """
    devices.remove(me, DeviceId(device_id), by=this)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/devices", status_code=status.HTTP_204_NO_CONTENT)
def remove_all(me: SignedInAccount, devices: DevicesDep, this: ThisDevice) -> Response:
    """Remove every allowed device but this one, ending their sessions; admins only."""
    devices.remove_all(me, by=this)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
