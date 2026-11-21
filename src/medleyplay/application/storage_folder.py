"""The folder Downloads are kept in: where it is, and showing it in Finder on the server's Mac.

Anyone signed in may read where the folder is. Only an admin whose request comes from
the Mac medleyplay runs on may have Finder show it, since Finder opens on that Mac's
screen; the folder shown is always this one, never a path a request names.
"""

import subprocess  # nosec B404 -- runs only macOS's `open`, never a shell
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from medleyplay.domain.accounts import Account
from medleyplay.domain.errors import ConflictError, ForbiddenError

type ShowFolder = Callable[[Path], None]
"""Shows a folder in Finder; raises `OSError` or `subprocess.SubprocessError` when it can't."""

OPEN = "/usr/bin/open"
SHOW_TIMEOUT = 10
"""Seconds `open` may take to hand the folder to Finder."""


@dataclass(frozen=True)
class FolderShown:
    """Where the Downloads folder is, from the home folder where it is inside it."""

    path: str
    can_show: bool
    """Whether the caller may have Finder show it."""


def show_in_finder(folder: Path) -> None:
    """Have Finder show `folder`, with macOS's `open`."""
    subprocess.run(  # noqa: S603  # nosec B603 -- a fixed program and folder, no shell
        [OPEN, str(folder)], check=True, timeout=SHOW_TIMEOUT, capture_output=True
    )


class StorageFolder:
    """The Downloads folder, and Finder to show it in where the server runs on a Mac."""

    def __init__(self, folder: Path, show: ShowFolder | None, *, home: Path) -> None:
        """Name `folder`, shown by `show`, or by nothing when `None`; paths in `home` start `~`."""
        self._folder = folder
        self._show = show
        self._home = home

    def where(self, caller: Account, *, local: bool) -> FolderShown:
        """Return where the folder is, and whether `caller`, here if `local`, may show it."""
        if self._folder.is_relative_to(self._home):
            path = f"~/{self._folder.relative_to(self._home).as_posix()}"
        else:
            path = self._folder.as_posix()
        return FolderShown(path, self._may_show(caller, local=local))

    def show(self, caller: Account, *, local: bool) -> None:
        """Have Finder show the folder, making it first if no Download has yet."""
        if not caller.is_admin:
            message = "Only an admin may show the Downloads folder."
            raise ForbiddenError(message)
        if self._show is None or not local:
            message = "The Downloads folder shows in Finder only on the Mac medleyplay runs on."
            raise ConflictError(message)
        try:
            self._folder.mkdir(parents=True, exist_ok=True)
            self._show(self._folder)
        except (OSError, subprocess.SubprocessError) as error:
            message = "Finder could not show the Downloads folder."
            raise ConflictError(message) from error

    def _may_show(self, caller: Account, *, local: bool) -> bool:
        return caller.is_admin and local and self._show is not None
