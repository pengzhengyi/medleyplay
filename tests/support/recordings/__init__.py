"""Answers recorded from real sites, kept as the data they gave.

`BV1AC4y1L7Yi.info.json` is what yt-dlp extracted for one Bilibili video when the
household read it through its own proxy: the title, uploader, description, duration,
cover, and formats, trimmed to what medleyplay reads. The signed media URLs are
replaced by `https://example.invalid/<format id>`, so nothing in it is fetched.
"""

import json
from collections.abc import Mapping
from pathlib import Path
from typing import Final

RECORDINGS: Final = Path(__file__).parent


def recorded_info(video: str) -> Mapping[str, object]:
    """Return yt-dlp's recorded info for the Bilibili `video`, as a new copy each time."""
    info = json.loads((RECORDINGS / f"{video}.info.json").read_text(encoding="utf-8"))
    if not isinstance(info, dict):
        message = f"The recording of {video} isn't a JSON object."
        raise TypeError(message)
    return info
