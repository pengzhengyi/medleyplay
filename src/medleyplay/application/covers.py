"""Covers: images kept once in the data folder, named by their content, shown on Tracks.

A cover's file is named by the SHA-256 of its bytes, so the songs of an album share
one file, and a name never changes while its content stands. A cover no value
names any more is removed by the sweep.
"""

import contextlib
import os
import tempfile
from collections.abc import Callable
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application import Clock
from medleyplay.application.details import set_household
from medleyplay.domain.catalog import TrackId
from medleyplay.domain.covers import MAX_COVER_BYTES, CoverType, cover_id, cover_type, is_cover_id
from medleyplay.domain.details import Field
from medleyplay.domain.errors import InvalidInputError
from medleyplay.persistence.schema import TrackValueRow

COVERS_FOLDER = "covers"
"""Where covers are kept in the data folder."""


class CoverService:
    """Keep covers, set and remove the household's, and sweep those no value names."""

    def __init__(
        self,
        units: sessionmaker[Session],
        clock: Clock,
        folder: Path,
        on_change: Callable[[str], None] | None = None,
    ) -> None:
        """Create a service keeping covers in `folder`, telling `on_change` of each change."""
        self._units = units
        self._clock = clock
        self._folder = folder
        self._on_change = on_change

    def set_cover(self, track_id: TrackId, data: bytes) -> str:
        """Make the image `data` the household's cover for the Track; return its name.

        A JPEG, PNG, or WebP image of at most 10 MiB, known by its first bytes, is
        kept; anything else is refused.
        """
        if len(data) > MAX_COVER_BYTES:
            message = f"A cover is at most {MAX_COVER_BYTES // (1024 * 1024)} MiB."
            raise InvalidInputError(message)
        if cover_type(data) is None:
            message = "A cover is a JPEG, PNG, or WebP image."
            raise InvalidInputError(message)
        name = cover_id(data)
        with self._units.begin() as db:
            set_household(db, track_id, {Field.COVER: name}, self._clock())
            self._keep(name, data)
        self._changed()
        return name

    def remove_cover(self, track_id: TrackId) -> None:
        """Drop the household's cover for the Track, so the next origin's shows."""
        with self._units.begin() as db:
            set_household(db, track_id, {Field.COVER: None}, self._clock())
        self._changed()

    def open(self, name: str) -> tuple[Path, CoverType] | None:
        """Return the cover `name`'s file and its type, or `None` when there is none."""
        if not is_cover_id(name):
            return None
        path = self._folder / name
        try:
            with path.open("rb") as file:
                kind = cover_type(file.read(12))
        except OSError:
            return None
        return None if kind is None or path.is_symlink() else (path, kind)

    def sweep(self) -> None:
        """Remove every file in the covers folder that no value names."""
        if not self._folder.is_dir():
            return
        with self._units() as db:
            named = set(
                db.scalars(
                    select(TrackValueRow.value).where(TrackValueRow.field == Field.COVER).distinct()
                )
            )
        for file in self._folder.iterdir():
            if file.name not in named:
                with contextlib.suppress(OSError):
                    file.unlink()

    def _keep(self, name: str, data: bytes) -> None:
        # Written aside under a name of its own, flushed to the disk, and moved into
        # place, so neither a reader nor a crash leaves half a cover under its name.
        path = self._folder / name
        if path.is_file():
            return
        self._folder.mkdir(parents=True, exist_ok=True)
        handle, aside = tempfile.mkstemp(dir=self._folder, suffix=".tmp")
        try:
            with os.fdopen(handle, "wb") as file:
                file.write(data)
                file.flush()
                os.fsync(file.fileno())
            Path(aside).replace(path)
        except BaseException:
            Path(aside).unlink(missing_ok=True)
            raise

    def _changed(self) -> None:
        if self._on_change is not None:
            self._on_change("catalog")
