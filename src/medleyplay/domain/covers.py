"""Covers: an image known by its first bytes, kept once and named by its content.

The songs of an album share one cover file, named by the SHA-256 of its bytes, so
its name never changes while its content stands.
"""

import hashlib
import re
from enum import StrEnum
from typing import Final

MAX_COVER_BYTES: Final = 10 * 1024 * 1024
"""A cover larger than this is refused."""

_COVER_ID: Final = re.compile(r"[0-9a-f]{64}")


class CoverType(StrEnum):
    """The kinds of image a cover may be, by media type."""

    JPEG = "image/jpeg"
    PNG = "image/png"
    WEBP = "image/webp"


def cover_type(data: bytes) -> CoverType | None:
    """Return the kind of image `data` begins as, or `None` for anything else."""
    if data.startswith(b"\xff\xd8\xff"):
        return CoverType.JPEG
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return CoverType.PNG
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return CoverType.WEBP
    return None


def cover_id(data: bytes) -> str:
    """Return the name of the cover holding `data`: the SHA-256 of its bytes, in hex."""
    return hashlib.sha256(data).hexdigest()


def is_cover_id(name: str) -> bool:
    """Return whether `name` could name a cover."""
    return _COVER_ID.fullmatch(name) is not None
