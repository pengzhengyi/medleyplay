"""Proxies: an admin sets the household's proxy for a site, and plugin calls read it from memory.

The URL, which may hold a password, lives in the Keychain and the catalog keeps a
summary. The Keychain is written first and the row second, so a crash between them
leaves a URL with no row, which the next save replaces. Once read, the URL stays in
memory, so a plugin call never waits on the Keychain while it holds the plugin host.

Saving or removing a proxy tells the listeners and changes nothing else: no fault
is reset, no Job retried, and no Source's state touched.
"""

import threading
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import delete
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application import Clock
from medleyplay.application.secrets import Secrets
from medleyplay.domain.accounts import Account
from medleyplay.domain.errors import ForbiddenError, KeychainUnavailableError
from medleyplay.domain.proxies import (
    PROXY_SITES,
    ProxyScheme,
    ProxySummary,
    ProxyUrl,
    check_proxy_site,
    proxy_secret_name,
)
from medleyplay.persistence.schema import ProxyRow


@dataclass(frozen=True)
class SavedProxy:
    """A site's proxy as shown: what it is, never its login, and when it was saved."""

    summary: ProxySummary
    saved_at: datetime


class ProxyService:
    """Set, show, and remove each site's proxy, and hand its URL to calls that need it."""

    def __init__(self, units: sessionmaker[Session], clock: Clock, secrets: Secrets) -> None:
        """Create a service keeping proxy URLs in `secrets`."""
        self._units = units
        self._clock = clock
        self._secrets = secrets
        self._locks: defaultdict[str, threading.Lock] = defaultdict(threading.Lock)
        self._urls: dict[str, str | None] = {}
        self._listeners: list[Callable[[], None]] = []

    def listen(self, listener: Callable[[], None]) -> None:
        """Call `listener` each time a proxy is saved or removed."""
        self._listeners.append(listener)

    def get(self, caller: Account, site: str) -> SavedProxy | None:
        """Return the site's proxy as shown, or `None` when none is set; admins only."""
        _require_admin(caller)
        check_proxy_site(site)
        with self._units() as db:
            row = db.get(ProxyRow, site)
            return None if row is None else _to_saved(row)

    def save(self, caller: Account, site: str, text: str) -> SavedProxy:
        """Check `text` as the site's proxy and keep it, replacing any; admins only.

        Nothing is fetched to try it.
        """
        _require_admin(caller)
        name = proxy_secret_name(site)
        proxy = ProxyUrl.parse(text)
        with self._locks[site]:
            self._secrets.set(name, proxy.url)
            with self._units.begin() as db:
                row = db.get(ProxyRow, site) or ProxyRow(site=site)
                row.scheme = proxy.scheme
                row.host = proxy.host
                row.port = proxy.port
                row.has_login = proxy.user is not None
                row.saved_at = self._clock()
                db.add(row)
                db.flush()
                saved = _to_saved(row)
            self._urls[site] = proxy.url
        self._changed()
        return saved

    def remove(self, caller: Account, site: str) -> None:
        """Forget the site's proxy; forgetting one that isn't set is fine; admins only."""
        _require_admin(caller)
        name = proxy_secret_name(site)
        with self._locks[site]:
            self._secrets.delete(name)
            with self._units.begin() as db:
                db.execute(delete(ProxyRow).where(ProxyRow.site == site))
            self._urls[site] = None
        self._changed()

    def current(self, site: str) -> str | None:
        """Return the URL calls for `site` go through, or `None` when no proxy is set.

        The Keychain is asked once; the URL is then in memory. A Keychain that
        doesn't answer raises `KeychainUnavailableError`, and so does one that no
        longer holds a proxy the catalog has: a call never goes direct instead.
        """
        if site not in PROXY_SITES:
            return None
        if site in self._urls:
            return self._urls[site]
        with self._locks[site]:
            if site not in self._urls:
                self._urls[site] = self._read(site)
            return self._urls[site]

    def _read(self, site: str) -> str | None:
        with self._units() as db:
            if db.get(ProxyRow, site) is None:
                return None
        url = self._secrets.get(proxy_secret_name(site))
        if url is None:
            message = f"The {site} proxy is no longer in the Keychain; set it again."
            raise KeychainUnavailableError(message)
        return url

    def _changed(self) -> None:
        for listener in self._listeners:
            listener()


def _to_saved(row: ProxyRow) -> SavedProxy:
    summary = ProxySummary(ProxyScheme(row.scheme), row.host, row.port, row.has_login)
    return SavedProxy(summary, row.saved_at)


def _require_admin(caller: Account) -> None:
    if not caller.is_admin:
        message = "Only an admin can manage proxies."
        raise ForbiddenError(message)
