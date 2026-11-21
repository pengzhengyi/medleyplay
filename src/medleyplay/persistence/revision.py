"""The database revision: a number that changes whenever a write changes rows."""

import threading
from collections.abc import Iterator
from contextlib import contextmanager
from sqlite3 import Connection as SQLiteConnection

from sqlalchemy import Engine, event
from sqlalchemy.pool import ConnectionPoolEntry, PoolProxiedConnection

# cspell:ignore checkin
_CHANGES_AT_CHECKOUT = "changes_at_checkout"

_ignoring = threading.local()


class DatabaseRevision:
    """Counts the units of work that changed rows, so an answer built from them can be kept.

    SQLite counts, per connection, every row inserted, updated, or deleted. The pool
    notes that count when it lends a connection and compares when it is given back,
    after its transaction ended; the revision goes up only if rows changed. A write
    that matches no rows leaves it alone, and every way of writing counts.
    """

    def __init__(self) -> None:
        """Start at revision zero."""
        self._value = 0
        self._lock = threading.Lock()

    @property
    def value(self) -> int:
        """Return the current revision."""
        return self._value

    def bump(self) -> None:
        """Move to the next revision."""
        with self._lock:
            self._value += 1

    @staticmethod
    @contextmanager
    def ignoring() -> Iterator[None]:
        """Leave the revision alone for connections this thread gives back inside the block.

        Only for bookkeeping, such as when a session was last seen: a write here must
        change nothing a cached answer is built from, or that answer goes stale.
        """
        outer = getattr(_ignoring, "on", False)
        _ignoring.on = True
        try:
            yield
        finally:
            _ignoring.on = outer

    def watch(self, engine: Engine) -> None:
        """Bump the revision whenever a connection of `engine` returns having changed rows.

        A connection that is invalidated returns with no count to compare, so it bumps.
        """
        event.listen(engine, "checkout", self._lent)
        event.listen(engine, "checkin", self._returned)

    @staticmethod
    def _lent(
        dbapi_connection: SQLiteConnection,
        record: ConnectionPoolEntry,
        _proxy: PoolProxiedConnection,
    ) -> None:
        record.info[_CHANGES_AT_CHECKOUT] = dbapi_connection.total_changes

    def _returned(
        self, dbapi_connection: SQLiteConnection | None, record: ConnectionPoolEntry
    ) -> None:
        lent_at = record.info.pop(_CHANGES_AT_CHECKOUT, None)
        if getattr(_ignoring, "on", False) and dbapi_connection is not None:
            return
        if dbapi_connection is None or lent_at != dbapi_connection.total_changes:
            self.bump()
