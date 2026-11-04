"""What a cover image is, for the plugins and Job programs that find one.

A cover is a JPEG, PNG, or WebP image of at most 10 MiB, known by its first bytes,
not by the name of its file: bytes that begin `GIF89a` are no cover.
"""

from typing import Final

MAX_COVER_BYTES: Final = 10 * 1024 * 1024
"""An image longer than this is not a cover."""


def is_cover_image(data: bytes) -> bool:
    """Return whether `data` begins as a JPEG, PNG, or WebP image."""
    return data.startswith((b"\xff\xd8\xff", b"\x89PNG\r\n\x1a\n")) or (
        data[:4] == b"RIFF" and data[8:12] == b"WEBP"
    )
