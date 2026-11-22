"""Moving the data folder to another place, its old copy deleted only once the new one checks out.

```text
source/              ──copy──▶  .target.moving/  ──check──▶  target/   then source/ deleted
  medleyplay.sqlite3              every file's size,
  covers/ downloads/ …            the database's integrity
```

No server may use either folder while it moves; the caller holds the server's lock.
"""

import contextlib
import json
import shutil
import sqlite3
from collections.abc import Callable, Collection, Iterator
from dataclasses import dataclass
from pathlib import Path

from medleyplay.persistence.database import database_path

type CopyFile = Callable[[str, str], object]


class DataMoveError(Exception):
    """The data folder can't be moved there; nothing was changed."""


@dataclass(frozen=True)
class Moved:
    """What a move carried: how many files, and how many bytes in all."""

    files: int
    size: int


def move_data_folder(
    source: Path,
    target: Path,
    *,
    leave: Collection[str] = (),
    copy_file: CopyFile = shutil.copy2,
) -> Moved:
    """Move the data folder `source` to `target`, a new or empty folder, and delete `source`.

    The files named in `leave`, at the top of `source`, aren't carried, such as the
    server's lock. Every file is copied to a folder beside `target` and checked, its
    size and the database's integrity, before it becomes `target`; a copy that doesn't
    match is removed and `source` is left as it was. The Jobs that name `source` in
    their requests name `target` from then on.
    """
    source, target = source.resolve(), target.resolve()
    _check_move(source, target)
    _settle_database(source)
    staging = target.with_name(f".{target.name}.moving")
    shutil.rmtree(staging, ignore_errors=True)
    staging.parent.mkdir(parents=True, exist_ok=True)
    try:
        shutil.copytree(
            source,
            staging,
            ignore=lambda folder, _: [n for n in leave if Path(folder) == source],
            copy_function=copy_file,
        )
        moved = _check_copy(source, staging, leave)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    if target.exists():
        target.rmdir()
    staging.rename(target)
    _rename_in_jobs(target, source, target)
    shutil.rmtree(source)
    return moved


def _check_move(source: Path, target: Path) -> None:
    if not database_path(source).exists():
        message = f"No medleyplay database in {source}; nothing was moved."
        raise DataMoveError(message)
    if target == source or target.is_relative_to(source):
        message = f"{target} is inside {source}; choose a folder outside it."
        raise DataMoveError(message)
    if target.exists() and any(target.iterdir()):
        message = f"{target} already holds files; choose a new or empty folder."
        raise DataMoveError(message)


def _settle_database(folder: Path) -> None:
    """Write the database's log into the database itself, so its files stop changing."""
    with _connection(database_path(folder)) as db:
        db.execute("PRAGMA wal_checkpoint(TRUNCATE)")


def _check_copy(source: Path, copy: Path, leave: Collection[str]) -> Moved:
    files = size = 0
    for original in _files_under(source):
        relative = original.relative_to(source)
        if len(relative.parts) == 1 and relative.name in leave:
            continue
        copied = copy / relative
        expected = original.stat().st_size
        found = copied.stat().st_size if copied.is_file() else None
        if found != expected:
            message = (
                f"The copy of {relative.as_posix()} is {found} bytes, not {expected}; "
                f"nothing was moved."
            )
            raise DataMoveError(message)
        files += 1
        size += expected
    with _connection(database_path(copy)) as db:
        [answer] = db.execute("PRAGMA integrity_check").fetchone()
    if answer != "ok":
        message = f"The copied database isn't sound ({answer}); nothing was moved."
        raise DataMoveError(message)
    return Moved(files=files, size=size)


def _files_under(folder: Path) -> Iterator[Path]:
    return (path for path in sorted(folder.rglob("*")) if path.is_file())


def _rename_in_jobs(folder: Path, old: Path, new: Path) -> None:
    """Make the Jobs in `folder`'s database that name `old` name `new` instead."""
    # As a path is written in a request's JSON: from its opening quote to its closing one,
    # or to the slash before a name inside it, so `/data` never matches `/database`.
    before, after = json.dumps(str(old))[:-1], json.dumps(str(new))[:-1]
    with _connection(database_path(folder)) as db:
        for end in ('"', "/"):
            db.execute(
                "UPDATE job SET request = replace(request, ?, ?) WHERE instr(request, ?) > 0",
                (before + end, after + end, before + end),
            )


@contextlib.contextmanager
def _connection(path: Path) -> Iterator[sqlite3.Connection]:
    db = sqlite3.connect(path)
    try:
        with db:
            yield db
    finally:
        db.close()
