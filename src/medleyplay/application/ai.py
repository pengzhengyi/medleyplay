"""The AI providers: an admin adds, orders, and removes them, and Jobs are lent them in order.

Each key lives in the Keychain, and the catalog keeps the address, the model, and the
name the key is kept under. A key is written before its row and forgotten after it,
so a crash in between leaves a key no row names, which nothing reads.
"""

import contextlib
import threading
import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application import Clock
from medleyplay.application.secrets import Secrets
from medleyplay.domain.accounts import Account
from medleyplay.domain.ai import (
    MAX_PROVIDERS,
    ProviderFailed,
    ProviderFailure,
    UnusableReason,
    check_base_url,
    check_key,
    check_model,
    key_secret,
)
from medleyplay.domain.errors import (
    ConflictError,
    ForbiddenError,
    KeychainUnavailableError,
    NotFoundError,
)
from medleyplay.persistence.schema import AiProviderRow
from medleyplay.plugin_api import AiEndpoint


@dataclass(frozen=True)
class SavedProvider:
    """A provider as shown: which it is, where, the model asked, and how it last did.

    `failure` is why it last gave no answer, at `failed_at`, until it answers again; for
    an unusable answer, `failure_reason` says what was wrong, and `failure_status` the
    status of a request it refused.
    The key is never shown, only whether there is one.
    """

    id: str
    base_url: str
    model: str
    has_key: bool
    saved_at: datetime
    failure: ProviderFailure | None = None
    failed_at: datetime | None = None
    failure_reason: UnusableReason | None = None
    failure_status: int | None = None


def is_set_up(db: Session) -> bool:
    """Return whether an admin has set up a provider."""
    return db.scalar(select(func.count()).select_from(AiProviderRow)) != 0


def record_answers(
    db: Session,
    answered: str | None,
    failures: Iterable[tuple[str, ProviderFailed]],
    now: datetime,
) -> None:
    """Note that `answered` answered and why each of `failures` didn't; gone ones are skipped."""
    for provider_id, failed in failures:
        row = db.get(AiProviderRow, provider_id)
        if row is not None:
            _note(row, failed, now)
    row = None if answered is None else db.get(AiProviderRow, answered)
    if row is not None:
        _note(row, None, None)


def _note(row: AiProviderRow, failed: ProviderFailed | None, now: datetime | None) -> None:
    """Note why the provider last gave no answer to use, or `None` once it answers."""
    row.failure = None if failed is None else failed.failure
    row.failure_reason = None if failed is None else failed.reason
    row.failure_status = None if failed is None else failed.status
    row.failed_at = now


class AiService:
    """Add, show, order, change, and remove the AI providers, and lend them to Jobs."""

    def __init__(self, units: sessionmaker[Session], clock: Clock, secrets: Secrets) -> None:
        """Create a service keeping the providers' keys in `secrets`."""
        self._units = units
        self._clock = clock
        self._secrets = secrets
        self._lock = threading.Lock()

    def providers(self, caller: Account) -> list[SavedProvider]:
        """Return the providers in the order they are asked; admins only."""
        _require_admin(caller)
        with self._units() as db:
            return [_to_saved(row) for row in _in_order(db)]

    def add(self, caller: Account, base_url: str, model: str, key: str | None) -> SavedProvider:
        """Add a provider after the others, with `key` when it needs one; admins only.

        A provider of the same address and model, or one more than `MAX_PROVIDERS`, is
        refused. Nothing is sent to the provider to try it.
        """
        _require_admin(caller)
        address, name = check_base_url(base_url), check_model(model)
        checked = None if key is None else check_key(key)
        provider_id = uuid.uuid4().hex
        secret = None if checked is None else key_secret(provider_id)
        with self._lock:
            with self._units() as db:
                rows = _in_order(db)
                _require_room(rows)
                _require_new(rows, address, name)
                position = max((row.position for row in rows), default=-1) + 1
            if secret is not None and checked is not None:
                self._secrets.set(secret, checked)
            with self._units.begin() as db:
                row = AiProviderRow(
                    id=provider_id,
                    position=position,
                    base_url=address,
                    model=name,
                    key_secret=secret,
                    saved_at=self._clock(),
                )
                db.add(row)
                db.flush()
                return _to_saved(row)

    def replace_key(self, caller: Account, provider_id: str, key: str) -> SavedProvider:
        """Replace the provider's key, or give it one, keeping its place; admins only."""
        _require_admin(caller)
        checked = check_key(key)
        with self._lock:
            with self._units() as db:
                secret = _row_of(db, provider_id).key_secret or key_secret(provider_id)
            self._secrets.set(secret, checked)
            with self._units.begin() as db:
                row = _row_of(db, provider_id)
                row.key_secret, row.saved_at = secret, self._clock()
                _note(row, None, None)
                db.flush()
                return _to_saved(row)

    def change_model(self, caller: Account, provider_id: str, model: str) -> SavedProvider:
        """Ask another model of the provider, keeping its place and key; admins only."""
        _require_admin(caller)
        name = check_model(model)
        with self._lock, self._units.begin() as db:
            row = _row_of(db, provider_id)
            others = [each for each in _in_order(db) if each.id != provider_id]
            _require_new(others, row.base_url, name)
            row.model, row.saved_at = name, self._clock()
            _note(row, None, None)
            db.flush()
            return _to_saved(row)

    def reorder(self, caller: Account, provider_ids: Sequence[str]) -> list[SavedProvider]:
        """Ask the providers in the order of `provider_ids`, which names each once; admins only.

        A list that names other providers than there are is refused, as the providers
        changed since it was read.
        """
        _require_admin(caller)
        with self._lock, self._units.begin() as db:
            rows = {row.id: row for row in _in_order(db)}
            if len(provider_ids) != len(rows) or set(provider_ids) != rows.keys():
                message = "The AI providers changed since they were shown; here they are now."
                raise ConflictError(message)
            for position, provider_id in enumerate(provider_ids):
                rows[provider_id].position = position
            db.flush()
            return [_to_saved(rows[each]) for each in provider_ids]

    def remove(self, caller: Account, provider_id: str) -> None:
        """Forget the provider and its key, also when there is none; admins only."""
        _require_admin(caller)
        with self._lock:
            with self._units.begin() as db:
                row = db.get(AiProviderRow, provider_id)
                if row is None:
                    return
                secret = row.key_secret
                db.delete(row)
            if secret is not None:
                # The provider is gone either way; a key a Keychain kept is named by no row.
                with contextlib.suppress(KeychainUnavailableError):
                    self._secrets.delete(secret)

    def endpoints(self) -> tuple[AiEndpoint, ...]:
        """Return the providers for a Job, in order, or none when none is set up.

        A provider whose key the Keychain no longer holds is left out and marked so. A
        Keychain that doesn't answer raises `KeychainUnavailableError`, and so does one
        that holds the key of no provider.
        """
        with self._units() as db:
            rows = [(row.id, row.base_url, row.model, row.key_secret) for row in _in_order(db)]
        lent: list[AiEndpoint] = []
        missing: list[str] = []
        for provider_id, base_url, model, secret in rows:
            key = None if secret is None else self._secrets.get(secret)
            if secret is not None and key is None:
                missing.append(provider_id)
                continue
            lent.append(AiEndpoint(id=provider_id, base_url=base_url, model=model, key=key))
        if missing:
            with self._units.begin() as db:
                failures = [(each, ProviderFailed(ProviderFailure.KEY_MISSING)) for each in missing]
                record_answers(db, None, failures, self._clock())
        if rows and not lent:
            message = "The AI providers' keys are no longer in the Keychain; replace them."
            raise KeychainUnavailableError(message)
        return tuple(lent)


def _in_order(db: Session) -> list[AiProviderRow]:
    return list(db.scalars(select(AiProviderRow).order_by(AiProviderRow.position)))


def _row_of(db: Session, provider_id: str) -> AiProviderRow:
    row = db.get(AiProviderRow, provider_id)
    if row is None:
        message = "That AI provider is no longer set up."
        raise NotFoundError(message)
    return row


def _require_room(rows: Sequence[AiProviderRow]) -> None:
    if len(rows) >= MAX_PROVIDERS:
        message = f"At most {MAX_PROVIDERS} AI providers are kept; remove one first."
        raise ConflictError(message)


def _require_new(rows: Iterable[AiProviderRow], base_url: str, model: str) -> None:
    if any((row.base_url, row.model) == (base_url, model) for row in rows):
        message = "That provider and model are set up already."
        raise ConflictError(message)


def _to_saved(row: AiProviderRow) -> SavedProvider:
    failure = None if row.failure is None else ProviderFailure(row.failure)
    reason = None if row.failure_reason is None else UnusableReason(row.failure_reason)
    return SavedProvider(
        id=row.id,
        base_url=row.base_url,
        model=row.model,
        has_key=row.key_secret is not None,
        saved_at=row.saved_at,
        failure=failure,
        failed_at=row.failed_at,
        failure_reason=reason,
        failure_status=row.failure_status,
    )


def _require_admin(caller: Account) -> None:
    if not caller.is_admin:
        message = "Only an admin can set up the AI providers."
        raise ForbiddenError(message)
