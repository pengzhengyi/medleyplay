"""Where medleyplay keeps its files, and showing those folders on the server's Mac.

Anyone signed in may read where Downloads are kept. Only admins see the server data
folder, and only from the server's Mac can they have Finder show either folder.
"""

import subprocess  # nosec B404 -- runs only macOS's `open`, never a shell
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from medleyplay.domain.accounts import Account
from medleyplay.domain.downloads import DOWNLOADS_FOLDER
from medleyplay.domain.errors import ConflictError, ForbiddenError

type FolderScope = Literal["downloads", "server"]
type ShowFolder = Callable[[Path], None]
"""Shows a folder in Finder; raises `OSError` or `subprocess.SubprocessError` when it can't."""

OPEN = "/usr/bin/open"
SHOW_TIMEOUT = 10
"""Seconds `open` may take to hand the folder to Finder."""


@dataclass(frozen=True)
class FolderShown:
    """Where the folder is, starting at `~` when it is in the home folder."""

    path: str
    can_show: bool
    """Whether the caller may have Finder show it."""


def show_in_finder(folder: Path) -> None:
    """Have Finder show `folder`, with macOS's `open`."""
    subprocess.run(  # noqa: S603  # nosec B603 -- a fixed program and folder, no shell
        [OPEN, str(folder)], check=True, timeout=SHOW_TIMEOUT, capture_output=True
    )


class StorageFolder:
    """The server's fixed data and Downloads folders, with local Finder access."""

    def __init__(self, data_dir: Path, show: ShowFolder | None, *, home: Path) -> None:
        """Use `data_dir` and its Downloads folder, or no Finder when `show` is `None`."""
        self._data_dir = data_dir
        self._show = show
        self._home = home

    def where(
        self, caller: Account, *, local: bool, scope: FolderScope = "downloads"
    ) -> FolderShown:
        """Return where the folder is, and whether `caller`, here if `local`, may show it."""
        if scope == "server" and not caller.is_admin:
            message = "Only an admin may read the server storage folder."
            raise ForbiddenError(message)
        folder = self._path(scope)
        path = folder.as_posix()
        if folder.is_relative_to(self._home):
            relative = folder.relative_to(self._home)
            path = f"~/{relative.as_posix()}" if relative.parts else "~"
        return FolderShown(path, self._may_show(caller, local=local))

    def show(self, caller: Account, *, local: bool, scope: FolderScope = "downloads") -> None:
        """Have Finder show the selected folder, making it first if missing."""
        name = "server storage folder" if scope == "server" else "Downloads folder"
        if not caller.is_admin:
            message = f"Only an admin may show the {name}."
            raise ForbiddenError(message)
        if self._show is None or not local:
            message = f"Show the {name} in Finder only on the Mac medleyplay runs on."
            raise ConflictError(message)
        folder = self._path(scope)
        try:
            folder.mkdir(parents=True, exist_ok=True)
            self._show(folder)
        except (OSError, subprocess.SubprocessError) as error:
            message = f"Finder could not show the {name}."
            raise ConflictError(message) from error

    def _path(self, scope: FolderScope) -> Path:
        return self._data_dir if scope == "server" else self._data_dir / DOWNLOADS_FOLDER

    def _may_show(self, caller: Account, *, local: bool) -> bool:
        return caller.is_admin and local and self._show is not None
