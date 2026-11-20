"""The database revision: a number that changes whenever a write changes rows."""

import secrets
import threading
from sqlite3 import Connection as SQLiteConnection

from sqlalchemy import Engine, event
from sqlalchemy.pool import ConnectionPoolEntry, PoolProxiedConnection

_CHANGES_AT_CHECKOUT = "changes_at_checkout"


class DatabaseRevision:
    """Counts the units of work that changed rows, so an answer built from them can be kept.

    SQLite counts, per connection, every row inserted, updated, or deleted. The pool
    notes that count when it lends a connection and compares when it is given back,
    after its transaction ended; the revision goes up only if rows changed. A write
    that matches no rows leaves it alone, and every way of writing counts.

    The revision starts at zero with each server, so `mark`, chosen at random when it
    is created, tells one server's revisions from another's.
    """

    def __init__(self) -> None:
        """Start at revision zero with a new mark."""
        self.mark = secrets.token_hex(8)
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
        if dbapi_connection is None or lent_at != dbapi_connection.total_changes:
            self.bump()
