"""Downloads: the one copy of a site's Source on the server's disk.

A Source has at most one Download, named by its id, in the data folder:

```text
downloads/7.m4a
```

A Download is made by a site's downloader, or added by the household by hand, in
which case its backend is `manual`.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Final

from medleyplay.domain.catalog import SourceId
from medleyplay.domain.errors import InvalidInputError
from medleyplay.domain.playback import extension

DOWNLOADS_FOLDER: Final = "downloads"
DOWNLOAD_EXTENSIONS: Final = frozenset({"m4a"})
"""The types a Download may have: AAC audio, which every household browser plays."""
MANUAL_EXTENSIONS: Final = frozenset(
    {"m4a", "mp4", "mp3", "flac", "ogg", "oga", "opus", "wav", "aif", "aifc", "aiff"}
)
"""The types a file the household adds may have: audio the player serves."""
MANUAL_BACKEND: Final = "manual"
"""The backend of a Download the household added by hand."""
MAX_DOWNLOAD_BYTES: Final = 1024**3
BEST_QUALITY_KBPS: Final = 192
QUALITY_KBPS: Final = {"30280": 192, "30232": 132, "30216": 64}
"""The bitrate of each of Bilibili's AAC qualities; `best` counts as the highest."""


def quality_kbps(quality: str) -> int:
    """Return the bitrate a download at `quality` is estimated at."""
    return QUALITY_KBPS.get(quality, BEST_QUALITY_KBPS)


@dataclass(frozen=True)
class Download:
    """A Source's Download: its file's name, the quality it got, who made it, and its size."""

    source_id: SourceId
    file_name: str
    quality: str
    backend: str
    size: int
    downloaded_at: datetime


def download_name(source_id: SourceId, file: str) -> str:
    """Return the name a Source's Download has, from the name its plugin gave the file.

    Only an extension in `DOWNLOAD_EXTENSIONS` is accepted: `audio.M4A` makes `7.m4a`.
    """
    found = extension(file)
    if found not in DOWNLOAD_EXTENSIONS:
        message = f"{file!r} isn't audio a Download may hold."
        raise InvalidInputError(message)
    return f"{source_id}.{found}"


def manual_download_name(source_id: SourceId, file: str) -> str:
    """Return the name a file the household adds has as a Source's Download.

    `night.WAV` for the Source 7 makes `7.wav`; an extension outside `MANUAL_EXTENSIONS`,
    or none, is refused.
    """
    found = extension(file)
    if found not in MANUAL_EXTENSIONS:
        types = ", ".join(sorted(MANUAL_EXTENSIONS))
        message = f"{file!r} isn't a file medleyplay can play: its name ends in one of {types}."
        raise InvalidInputError(message)
    return f"{source_id}.{found}"


def download_target(source_id: SourceId) -> str:
    """Return the Job target that downloads a Source."""
    return f"source:{source_id}"
