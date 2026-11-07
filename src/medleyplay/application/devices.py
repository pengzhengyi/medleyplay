"""Devices, applied: asking, answering, admitting each request, and the household's choice.

The choice and the allowed devices are kept in memory, written through to the
database on every change, so admitting a request reads no table; one server
process owns the database. Devices waiting for an answer, or turned away, live
only in memory: forgotten on restart, they ask again.

```text
GET /api/device -> ask: host | allowed | admitted | waiting (with a code) | refused
any other /api  -> admit: admitted | waiting | refused, from what is known
```
"""

import logging
import secrets
import threading
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from enum import StrEnum
from typing import Final, Literal

from pydantic import BaseModel, ConfigDict
from sqlalchemy import delete, select, update
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application import Clock
from medleyplay.application.accounts import SESSION_IDLE_TIMEOUT, AccountService, hash_token
from medleyplay.domain.accounts import Account
from medleyplay.domain.devices import (
    Admission,
    Device,
    DeviceId,
    DeviceState,
    Verdict,
    admit,
    label_of,
)
from medleyplay.domain.errors import ConflictError, ForbiddenError, NotFoundError
from medleyplay.persistence.schema import DeviceRow, DeviceSettingRow, SessionRow

MAX_WAITING: Final = 10
"""How many devices may wait at once."""
MAX_WAITING_FROM_ONE_ADDRESS: Final = 3
WAIT_FOR: Final = timedelta(hours=1)
"""How long a device waits for an answer before it is forgotten."""
TURNED_AWAY_FOR: Final = timedelta(days=1)
SEEN_RESOLUTION: Final = timedelta(minutes=1)
"""A device's last-seen time and address are written at most this often, so reads stay reads."""
DEVICE_ROW: Final = 1
_log = logging.getLogger(__name__)


class DeviceDocument(BaseModel):
    """The household's choice as stored, version 1."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    version: Literal[1] = 1
    admission: Admission = Admission.ASK


class Presence(StrEnum):
    """What a device is to the server, as it asks."""

    HOST = "host"
    ALLOWED = "allowed"
    ADMITTED = "admitted"
    """Let in without being recorded: under Allow all, or before the first account."""
    WAITING = "waiting"
    REFUSED = "refused"


@dataclass(frozen=True)
class Visit:
    """A request as the device check sees it: its cookie, its peer, and whether it's the host."""

    token: str | None
    address: str
    host: bool


@dataclass(frozen=True)
class Asked:
    """What a device asking learns; `token` is a new cookie to give it, if it needs one."""

    presence: Presence
    label: str
    device_id: DeviceId | None = None
    code: str | None = None
    token: str | None = None


@dataclass(frozen=True)
class Waiting:
    """A device waiting for an answer."""

    id: DeviceId
    label: str
    address: str
    code: str
    since: datetime


@dataclass(frozen=True)
class DevicesView:
    """The choice, its revision, and the waiting and allowed devices, oldest first."""

    admission: Admission
    revision: int
    waiting: tuple[Waiting, ...]
    allowed: tuple[Device, ...]


@dataclass
class _Known:
    """What memory holds, guarded by the service's lock."""

    document: DeviceDocument
    revision: int
    allowed: dict[str, Device]
    """Each allowed device by its token's hash."""
    waiting: dict[str, Waiting]
    turned_away: dict[str, datetime]
    """Each device turned away by its token's hash, with when it may ask again."""


class DeviceService:
    """Which devices may reach the server: asking, answering, and admitting each request."""

    def __init__(
        self,
        units: sessionmaker[Session],
        clock: Clock,
        accounts: AccountService,
        *,
        new_token: Callable[[], str] = lambda: secrets.token_urlsafe(32),
        new_code: Callable[[], str] = lambda: f"{secrets.randbelow(10_000):04d}",
        new_id: Callable[[], str] = lambda: secrets.token_hex(8),
    ) -> None:
        """Create the service; it reads the database the first time it is used."""
        self._units = units
        self._clock = clock
        self._accounts = accounts
        self._new_token = new_token
        self._new_code = new_code
        self._new_id = new_id
        self._lock = threading.Lock()
        self._known: _Known | None = None
        self._set_up = False
        self._listeners: list[Callable[[], None]] = []

    def listen(self, listener: Callable[[], None]) -> None:
        """Call `listener` whenever a device starts waiting or is answered."""
        with self._lock:
            self._listeners.append(listener)

    def admit(self, visit: Visit) -> tuple[Verdict, DeviceId | None]:
        """Return what becomes of a request, and the allowed device it comes from, if any."""
        set_up = self._is_set_up()
        with self._lock:
            known = self._load()
            hashed = None if visit.token is None else hash_token(visit.token)
            state = self._state_of(known, hashed)
            verdict = admit(known.document.admission, local=visit.host, set_up=set_up, state=state)
            device = None if hashed is None else known.allowed.get(hashed)
            if visit.host or hashed is None or device is None:
                return verdict, None
            seen = self._seen(known, hashed, device, visit.address)
        if seen is not None:
            self._write_seen(seen)
        return verdict, device.id

    def ask(self, visit: Visit, user_agent: str, *, session_token: str | None) -> Asked:
        """Answer `GET /api/device`: what the device is, and a cookie if it needs one.

        A new device waits, unless the choice is to allow all or block new ones,
        or too many wait already.
        """
        label = label_of(user_agent)
        if visit.host:
            return Asked(Presence.HOST, label)
        verdict, device_id = self.admit(visit)
        if device_id is not None:
            return Asked(Presence.ALLOWED, label, device_id)
        enrolled = self._enroll_from_before(visit, label, session_token)
        if enrolled is not None:
            return enrolled
        if verdict is Verdict.ADMITTED:
            return Asked(Presence.ADMITTED, label)
        return self._wait(visit, label, verdict)

    def _wait(self, visit: Visit, label: str, verdict: Verdict) -> Asked:
        """Keep the device waiting, a new one with a new cookie, unless it is refused."""
        with self._lock:
            known = self._load()
            hashed = None if visit.token is None else hash_token(visit.token)
            if verdict is Verdict.REFUSED or self._full(known, visit.address, hashed):
                return Asked(Presence.REFUSED, label)
            if hashed is not None and hashed in known.waiting:
                waiting = replace(known.waiting[hashed], address=visit.address)
                known.waiting[hashed] = waiting
                return Asked(Presence.WAITING, waiting.label, code=waiting.code)
            token = self._new_token()
            waiting = Waiting(
                DeviceId(self._new_id()), label, visit.address, self._new_code(), self._clock()
            )
            known.waiting[hash_token(token)] = waiting
        self._tell()
        return Asked(Presence.WAITING, label, code=waiting.code, token=token)

    @staticmethod
    def _full(known: _Known, address: str, hashed: str | None) -> bool:
        """Return whether a new device from `address` would be one too many to wait."""
        if hashed is not None and hashed in known.waiting:
            return False
        from_address = sum(w.address == address for w in known.waiting.values())
        return len(known.waiting) >= MAX_WAITING or from_address >= MAX_WAITING_FROM_ONE_ADDRESS

    def allow_first(self, visit: Visit, user_agent: str, *, session_token: str) -> Asked:
        """Allow the device that set the household up, and link its new session to it."""
        token = self._new_token()
        with self._units.begin() as db:
            session = db.scalars(
                select(SessionRow).where(SessionRow.token_hash == hash_token(session_token))
            ).one()
            with self._lock:
                known = self._load()
                device = self._insert(db, hash_token(token), label_of(user_agent), visit.address)
                session.device_id = device.id
                known.allowed[hash_token(token)] = device
        return Asked(Presence.ALLOWED, device.label, device.id, token=token)

    def devices(self, caller: Account) -> DevicesView:
        """Return the choice and the devices; admins only."""
        _require_admin(caller)
        with self._lock:
            return self._view(self._load())

    def put_admission(self, caller: Account, admission: Admission, revision: int) -> DevicesView:
        """Change the choice read at `revision`; a stale one conflicts. Admins only."""
        _require_admin(caller)
        with self._units.begin() as db, self._lock:
            known = self._load()
            changed = known.document.model_copy(update={"admission": admission})
            if revision != known.revision or (
                changed != known.document and not _save(db, changed, revision, self._clock())
            ):
                message = "The choice for new devices changed since you read it; read it again."
                raise ConflictError(message)
            if changed != known.document:
                known.document, known.revision = changed, revision + 1
            return self._view(known)

    def allow(self, caller: Account, waiting_id: DeviceId) -> Device:
        """Allow a waiting device; admins only."""
        _require_admin(caller)
        with self._units.begin() as db, self._lock:
            known = self._load()
            hashed, waiting = self._waiting(known, waiting_id)
            device = self._insert(db, hashed, waiting.label, waiting.address, waiting.id)
            del known.waiting[hashed]
            known.allowed[hashed] = device
        self._tell()
        return device

    def turn_away(self, caller: Account, waiting_id: DeviceId) -> None:
        """Refuse a waiting device for a day; admins only."""
        _require_admin(caller)
        with self._lock:
            known = self._load()
            hashed, _ = self._waiting(known, waiting_id)
            del known.waiting[hashed]
            known.turned_away[hashed] = self._clock() + TURNED_AWAY_FOR
        self._tell()

    def remove(self, caller: Account, device_id: DeviceId, *, by: DeviceId | None) -> None:
        """Forget an allowed device and end its sessions; admins only, never from that device.

        `by` is the device making the request, None for the host. One already
        gone is fine.
        """
        _require_admin(caller)
        if device_id == by:
            message = (
                "This would disconnect this device; remove it from the host or another device."
            )
            raise ConflictError(message)
        self._forget(lambda device: device.id == device_id)

    def remove_all(self, caller: Account, *, by: DeviceId | None) -> None:
        """Forget every allowed device but `by`, the one making the request; admins only."""
        _require_admin(caller)
        self._forget(lambda device: device.id != by)

    def _forget(self, chosen: Callable[[Device], bool]) -> None:
        with self._units.begin() as db, self._lock:
            known = self._load()
            gone = {hashed: d for hashed, d in known.allowed.items() if chosen(d)}
            if gone:
                # Each device's sessions go with it, by the foreign key.
                db.execute(delete(DeviceRow).where(DeviceRow.id.in_([d.id for d in gone.values()])))
            for hashed in gone:
                del known.allowed[hashed]

    def _enroll_from_before(
        self, visit: Visit, label: str, session_token: str | None
    ) -> Asked | None:
        """Allow a browser signed in before devices began, and link its session to it."""
        if session_token is None:
            return None
        now = self._clock()
        with self._units.begin() as db:
            session = db.scalars(
                select(SessionRow).where(
                    SessionRow.token_hash == hash_token(session_token),
                    SessionRow.from_before_devices,
                    SessionRow.device_id.is_(None),
                )
            ).one_or_none()
            if session is None or now - session.last_seen_at > SESSION_IDLE_TIMEOUT:
                return None
            token = self._new_token()
            with self._lock:
                known = self._load()
                device = self._insert(db, hash_token(token), label, visit.address)
                session.device_id = device.id
                known.allowed[hash_token(token)] = device
        return Asked(Presence.ALLOWED, label, device.id, token=token)

    def _is_set_up(self) -> bool:
        # Once set up, always: the last admin can't be deleted.
        if not self._set_up:
            self._set_up = self._accounts.is_set_up()
        return self._set_up

    def _load(self) -> _Known:
        """Return what memory holds, reading the database the first time; the lock is held."""
        if self._known is None:
            with self._units() as db:
                row = db.get(DeviceSettingRow, DEVICE_ROW)
                document = (
                    DeviceDocument() if row is None else DeviceDocument.model_validate(row.document)
                )
                rows = db.scalars(select(DeviceRow).order_by(DeviceRow.allowed_at)).all()
                allowed = {r.token_hash: _to_device(r) for r in rows}
            self._known = _Known(document, 0 if row is None else row.revision, allowed, {}, {})
        self._expire(self._known)
        return self._known

    def _expire(self, known: _Known) -> None:
        now = self._clock()
        for hashed, waiting in list(known.waiting.items()):
            if now - waiting.since >= WAIT_FOR:
                del known.waiting[hashed]
        for hashed, until in list(known.turned_away.items()):
            if now >= until:
                del known.turned_away[hashed]

    @staticmethod
    def _state_of(known: _Known, hashed: str | None) -> DeviceState | None:
        if hashed is None:
            return None
        if hashed in known.allowed:
            return DeviceState.ALLOWED
        if hashed in known.turned_away:
            return DeviceState.TURNED_AWAY
        if hashed in known.waiting:
            return DeviceState.WAITING
        return None

    def _seen(self, known: _Known, hashed: str, device: Device, address: str) -> Device | None:
        """Return `device` as seen now from `address`, at most once a minute; the lock is held."""
        now = self._clock()
        if now - device.last_seen_at < SEEN_RESOLUTION:
            return None
        seen = replace(device, address=address, last_seen_at=now)
        known.allowed[hashed] = seen
        return seen

    def _write_seen(self, device: Device) -> None:
        try:
            with self._units.begin() as db:
                db.execute(
                    update(DeviceRow)
                    .where(DeviceRow.id == device.id)
                    .values(address=device.address, last_seen_at=device.last_seen_at)
                )
        except Exception:  # noqa: BLE001 -- when it was last seen mustn't refuse a request
            _log.exception("Recording when a device was last seen failed")

    def _insert(
        self, db: Session, hashed: str, label: str, address: str, device_id: DeviceId | None = None
    ) -> Device:
        now = self._clock()
        device = Device(device_id or DeviceId(self._new_id()), label, address, now, now)
        db.add(
            DeviceRow(
                id=device.id,
                token_hash=hashed,
                label=label,
                address=address,
                allowed_at=now,
                last_seen_at=now,
            )
        )
        db.flush()
        return device

    @staticmethod
    def _waiting(known: _Known, waiting_id: DeviceId) -> tuple[str, Waiting]:
        for hashed, waiting in known.waiting.items():
            if waiting.id == waiting_id:
                return hashed, waiting
        message = "That device is no longer waiting; it may have stopped asking."
        raise NotFoundError(message)

    @staticmethod
    def _view(known: _Known) -> DevicesView:
        return DevicesView(
            known.document.admission,
            known.revision,
            tuple(sorted(known.waiting.values(), key=lambda w: w.since)),
            tuple(sorted(known.allowed.values(), key=lambda d: d.allowed_at)),
        )

    def _tell(self) -> None:
        with self._lock:
            listeners = tuple(self._listeners)
        for listener in listeners:
            try:
                listener()
            except Exception:  # noqa: BLE001 -- one listener's failure mustn't keep the rest from hearing
                _log.exception("A listener to the devices failed")


def _require_admin(caller: Account) -> None:
    if not caller.is_admin:
        message = "Only an admin can answer devices or change who may connect."
        raise ForbiddenError(message)


def _to_device(row: DeviceRow) -> Device:
    return Device(DeviceId(row.id), row.label, row.address, row.allowed_at, row.last_seen_at)


def _save(db: Session, document: DeviceDocument, revision: int, now: datetime) -> bool:
    """Save `document` over the one read at `revision`; return whether it was still current."""
    values = {"document": document.model_dump(mode="json"), "updated_at": now}
    statement = (
        insert(DeviceSettingRow)
        .values(id=DEVICE_ROW, revision=1, **values)
        .on_conflict_do_nothing()
        if revision == 0
        else update(DeviceSettingRow)
        .where(DeviceSettingRow.id == DEVICE_ROW, DeviceSettingRow.revision == revision)
        .values(revision=revision + 1, **values)
    )
    return db.connection().execute(statement).rowcount == 1
