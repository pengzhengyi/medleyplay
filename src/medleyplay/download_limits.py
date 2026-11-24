"""Transfer limits shared by storage planning and Download Job processes."""

from typing import Final

MAX_DOWNLOAD_BYTES: Final = 1024**3
MAX_JOIN_INPUT_BYTES: Final = MAX_DOWNLOAD_BYTES
JOIN_SCRATCH_BYTES: Final = MAX_JOIN_INPUT_BYTES + MAX_DOWNLOAD_BYTES
JOIN_OUTPUT_KBPS: Final = 256
MIN_FREE: Final = 2 * 1024**3
_MIN_FREE_SHARE: Final = 0.05


def disk_floor(total_bytes: int) -> int:
    """Return the space that must remain free on a disk of `total_bytes`."""
    return max(MIN_FREE, int(total_bytes * _MIN_FREE_SHARE))
