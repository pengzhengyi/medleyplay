"""Applying the covers a scan found: what a Source keeps of them, and the `files` cover.

A file's cover is the one embedded in its tags, or else the one in the image beside
it. The Source's details keep what the next scan needs to skip a file it has read:

```text
cover_image        {"extension": "jpg", "size": 90_000, "modified_ns": 1, "name": "9f2c..."}
cover_image_error  why the image beside the file isn't a cover, until a later read is good
embedded_cover     the name of the cover in the file's tags
```
"""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Final

from sqlalchemy.orm import Session

from medleyplay.application import details
from medleyplay.application.covers import keep_cover
from medleyplay.domain.catalog import TrackId
from medleyplay.domain.covers import MAX_COVER_BYTES, cover_id, cover_type, is_cover_id
from medleyplay.domain.details import Field, Origin
from medleyplay.programs.scan_covers import CoverFile, CoverImage, ImageStamp
from medleyplay.programs.scan_library import ScannedFile

COVER_IMAGE: Final = "cover_image"
COVER_IMAGE_ERROR: Final = "cover_image_error"
EMBEDDED_COVER: Final = "embedded_cover"
COVER_KEYS: Final = frozenset({COVER_IMAGE, COVER_IMAGE_ERROR, EMBEDDED_COVER})
"""The keys of a Source's details for the covers of its file."""

_NOT_A_COVER: Final = "isn't a JPEG, PNG, or WebP image"


class _NotACoverError(Exception):
    """A copy the scan made holds bytes that are no cover."""


@dataclass(frozen=True)
class FileCover:
    """The cover a file gives its Track, and what its Source keeps of its covers."""

    name: str | None
    kept: dict[str, object]


def apply_covers(file: ScannedFile, previous: Mapping[str, object], folder: Path) -> FileCover:
    """Keep the covers the scan found for the file in `folder`; return its cover and its details.

    `previous` is what the Source kept. A file read again gives its embedded cover
    again; one not read keeps the embedded cover it had. An image that couldn't be
    read as a cover, or couldn't be opened, keeps the cover it gave before and notes
    the error.
    """
    embedded = _embedded(file, previous, folder)
    beside, kept = _beside(file.cover_image, previous, folder)
    if embedded is not None:
        kept[EMBEDDED_COVER] = embedded
    return FileCover(embedded or beside, kept)


def record_cover(db: Session, track_id: TrackId, name: str | None, now: datetime) -> None:
    """Make `name` the Track's cover from its file's tags, keeping their other values.

    Without a name the file gives no cover. A cover already recorded is left as it was.
    """
    found = dict(details.values_of(db, track_id).get(Origin.FILES, {}))
    if found.get(Field.COVER) == name:
        return
    found.pop(Field.COVER, None)
    if name is not None:
        found[Field.COVER] = name
    details.record(db, track_id, Origin.FILES, found, now)


def image_stamp_of(kept: object) -> ImageStamp | None:
    """Return the stamp of the image beside a file from what its Source kept, if it kept one."""
    if not isinstance(kept, dict):
        return None
    return ImageStamp(
        extension=str(kept["extension"]),
        size=int(str(kept["size"])),
        modified_ns=int(str(kept["modified_ns"])),
    )


def _embedded(file: ScannedFile, previous: Mapping[str, object], folder: Path) -> str | None:
    if file.tags is None:
        earlier = previous.get(EMBEDDED_COVER)
        return earlier if isinstance(earlier, str) else None
    if file.embedded_cover is None:
        return None
    try:
        return _keep(file.embedded_cover, folder)
    except (OSError, _NotACoverError):
        return None


def _beside(
    image: CoverImage | None, previous: Mapping[str, object], folder: Path
) -> tuple[str | None, dict[str, object]]:
    """Return the cover of the image beside the file, and what the Source keeps of the image."""
    if image is None:
        return None, {}
    before = previous.get(COVER_IMAGE)
    earlier = before.get("name") if isinstance(before, dict) else None
    name = earlier if isinstance(earlier, str) else None
    error = image.error
    if image.retry:
        return name, _unread(before, error)
    if image.cover is not None:
        try:
            name = _keep(image.cover, folder)
        except OSError as failure:
            return name, _unread(before, f"can't be read ({type(failure).__name__})")
        except _NotACoverError:
            error = _NOT_A_COVER
    elif not error:
        # Skipped as unchanged: an error noted before stands.
        error = str(previous.get(COVER_IMAGE_ERROR, ""))
    stamp: dict[str, object] = {
        "extension": image.extension,
        "size": image.size,
        "modified_ns": image.modified_ns,
    }
    if name is not None:
        stamp["name"] = name
    kept: dict[str, object] = {COVER_IMAGE: stamp}
    if error:
        kept[COVER_IMAGE_ERROR] = error
    return name, kept


def _unread(before: object, error: str) -> dict[str, object]:
    # The stamp read last, if any, so the next scan reads the image again.
    kept: dict[str, object] = {COVER_IMAGE: before} if isinstance(before, dict) else {}
    kept[COVER_IMAGE_ERROR] = error
    return kept


def _keep(copy: CoverFile, folder: Path) -> str:
    """Keep the scan's copy of a cover in `folder` unless it is already there; return its name."""
    if is_cover_id(copy.name) and (folder / copy.name).is_file():
        return copy.name
    with Path(copy.path).open("rb") as file:
        data = file.read(MAX_COVER_BYTES + 1)
    if len(data) > MAX_COVER_BYTES or cover_type(data) is None:
        raise _NotACoverError
    name = cover_id(data)
    keep_cover(folder, name, data)
    return name
