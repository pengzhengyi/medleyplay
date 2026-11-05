"""The AI provider: an admin sets its address, model, and key, and Jobs are lent them.

The key lives in the Keychain and the catalog keeps the address, the model, and
whether there is a key. The Keychain is written first and the row second, so a crash
between them leaves a key with no row, which the next save replaces.
"""

import threading
from dataclasses import dataclass
from datetime import datetime
from typing import Final

from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application import Clock
from medleyplay.application.secrets import Secrets
from medleyplay.domain.accounts import Account
from medleyplay.domain.ai import KEY_SECRET, check_base_url, check_key, check_model
from medleyplay.domain.errors import ForbiddenError, KeychainUnavailableError, NotFoundError
from medleyplay.persistence.schema import AiSettingRow
from medleyplay.plugin_api import AiEndpoint

SETTING_ROW: Final = 1


@dataclass(frozen=True)
class AiSetting:
    """The provider as shown: where it is and which model is asked, never the key."""

    base_url: str
    model: str
    has_key: bool
    saved_at: datetime


def is_set_up(db: Session) -> bool:
    """Return whether an admin has set up the provider."""
    return db.get(AiSettingRow, SETTING_ROW) is not None


class AiService:
    """Set up, show, and forget the AI provider, and lend it to Jobs."""

    def __init__(self, units: sessionmaker[Session], clock: Clock, secrets: Secrets) -> None:
        """Create a service keeping the provider's key in `secrets`."""
        self._units = units
        self._clock = clock
        self._secrets = secrets
        self._lock = threading.Lock()

    def get(self, caller: Account) -> AiSetting | None:
        """Return the provider as shown, or `None` when it is not set up; admins only."""
        _require_admin(caller)
        with self._units() as db:
            row = db.get(AiSettingRow, SETTING_ROW)
            return None if row is None else _to_setting(row)

    def save(self, caller: Account, base_url: str, model: str, key: str | None) -> AiSetting:
        """Set the provider's address and model, and its key when `key` is given; admins only.

        Without a `key`, the key it has stays. Nothing is sent to the provider to try it.
        """
        _require_admin(caller)
        address, name = check_base_url(base_url), check_model(model)
        checked = None if key is None else check_key(key)
        with self._lock:
            if checked is not None:
                self._secrets.set(KEY_SECRET, checked)
            with self._units.begin() as db:
                row = db.get(AiSettingRow, SETTING_ROW) or AiSettingRow(id=SETTING_ROW)
                row.base_url, row.model, row.saved_at = address, name, self._clock()
                row.has_key = checked is not None or bool(row.has_key)
                db.add(row)
                db.flush()
                return _to_setting(row)

    def remove_key(self, caller: Account) -> AiSetting:
        """Forget the provider's key and keep its address and model; admins only."""
        _require_admin(caller)
        with self._lock, self._units.begin() as db:
            row = db.get(AiSettingRow, SETTING_ROW)
            if row is None:
                message = "The AI provider is not set up."
                raise NotFoundError(message)
            self._secrets.delete(KEY_SECRET)
            row.has_key = False
            db.flush()
            return _to_setting(row)

    def remove(self, caller: Account) -> None:
        """Forget the provider and its key, also when it is not set up; admins only."""
        _require_admin(caller)
        with self._lock, self._units.begin() as db:
            self._secrets.delete(KEY_SECRET)
            row = db.get(AiSettingRow, SETTING_ROW)
            if row is not None:
                db.delete(row)

    def endpoint(self) -> AiEndpoint | None:
        """Return the provider for a Job, or `None` when it is not set up.

        A Keychain that doesn't answer raises `KeychainUnavailableError`, and so does
        one that no longer holds a key the catalog has.
        """
        with self._units() as db:
            row = db.get(AiSettingRow, SETTING_ROW)
            if row is None:
                return None
            base_url, model, has_key = row.base_url, row.model, row.has_key
        key = self._secrets.get(KEY_SECRET) if has_key else None
        if has_key and key is None:
            message = "The AI provider's key is no longer in the Keychain; enter it again."
            raise KeychainUnavailableError(message)
        return AiEndpoint(base_url=base_url, model=model, key=key)


def _to_setting(row: AiSettingRow) -> AiSetting:
    return AiSetting(row.base_url, row.model, row.has_key, row.saved_at)


def _require_admin(caller: Account) -> None:
    if not caller.is_admin:
        message = "Only an admin can set up the AI provider."
        raise ForbiddenError(message)
