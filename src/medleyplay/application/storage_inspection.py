"""Read-only accounting of files kept by the server, independent of the Download policy."""

import os
import stat
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from threading import Lock
from time import monotonic

from medleyplay.application.covers import COVERS_FOLDER
from medleyplay.application.thumbnails import THUMBNAILS_FOLDER
from medleyplay.domain.accounts import Account
from medleyplay.domain.downloads import DOWNLOADS_FOLDER
from medleyplay.domain.errors import ConflictError, ForbiddenError
from medleyplay.domain.playback import CACHE_FOLDER
from medleyplay.persistence.database import database_path


@dataclass(frozen=True)
class Inspection:
    """Logical file bytes by location, plus selected settings in effect at server startup."""

    downloads: int
    cache: int
    covers: int
    thumbnails: int
    database: int
    database_companions: int
    configuration: int
    multiple_accounts: bool
    safe_mode: bool
    wal_enabled: bool


class StorageInspection:
    """Share one on-demand measurement for a minute across admin requests."""

    def __init__(
        self,
        root: Path,
        config_name: str,
        *,
        multiple_accounts: bool,
        safe_mode: bool,
        wal_enabled: bool,
        clock: Callable[[], float] = monotonic,
    ) -> None:
        """Inspect the server's data folder without opening any of its files."""
        self._root = root
        self._config_name = config_name
        self._multiple_accounts = multiple_accounts
        self._safe_mode = safe_mode
        self._wal_enabled = wal_enabled
        self._clock = clock
        self._lock = Lock()
        self._expires = 0.0
        self._last: Inspection | None = None

    def inspect(self, caller: Account) -> Inspection:
        """Return a recent measurement to an admin; an unreadable folder has no estimate."""
        if not caller.is_admin:
            message = "Only an admin may inspect server storage."
            raise ForbiddenError(message)
        with self._lock:
            if self._last is None or self._clock() >= self._expires:
                try:
                    self._last = self._measure()
                except OSError as error:
                    message = "Server storage could not be measured. Check data folder access."
                    raise ConflictError(message) from error
                self._expires = self._clock() + 60
            return self._last

    def _measure(self) -> Inspection:
        files = _FileLengths()
        database = database_path(self._root).name
        with _directory(self._root) as root:
            return Inspection(
                downloads=files.folder(root, DOWNLOADS_FOLDER),
                cache=files.folder(root, CACHE_FOLDER),
                covers=files.folder(root, COVERS_FOLDER),
                thumbnails=files.recipes(root),
                database=files.size(root, database),
                database_companions=sum(
                    files.size(root, database + suffix) for suffix in ("-wal", "-shm", "-journal")
                ),
                configuration=files.size(root, self._config_name),
                multiple_accounts=self._multiple_accounts,
                safe_mode=self._safe_mode,
                wal_enabled=self._wal_enabled,
            )


@contextmanager
def _directory(name: str | Path, parent: int | None = None) -> Iterator[int]:
    # Pin each directory while reading its children, even if a link replaces its name.
    fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
    try:
        yield fd
    finally:
        os.close(fd)


class _FileLengths:
    def __init__(self) -> None:
        self._linked: set[tuple[int, int]] = set()

    def size(self, parent: int, name: str) -> int:
        try:
            info = os.stat(name, dir_fd=parent, follow_symlinks=False)
        except FileNotFoundError:
            return 0
        if not stat.S_ISREG(info.st_mode):
            return 0
        if info.st_nlink > 1:
            identity = (info.st_dev, info.st_ino)
            if identity in self._linked:
                return 0
            self._linked.add(identity)
        return info.st_size

    def folder(self, parent: int, path: str) -> int:
        name, _, rest = path.partition("/")
        try:
            with _directory(name, parent) as folder:
                if rest:
                    return self.folder(folder, rest)
                with os.scandir(folder) as entries:
                    return sum(self.size(folder, entry.name) for entry in entries)
        except (FileNotFoundError, NotADirectoryError):
            return 0

    def recipes(self, root: int) -> int:
        try:
            with _directory(THUMBNAILS_FOLDER, root) as folder, os.scandir(folder) as entries:
                return sum(
                    self.folder(folder, entry.name) for entry in entries if entry.name.isdecimal()
                )
        except (FileNotFoundError, NotADirectoryError):
            return 0
