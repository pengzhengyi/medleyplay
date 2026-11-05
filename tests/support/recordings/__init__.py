"""Answers recorded from real sites, kept as the data they gave.

`BV1AC4y1L7Yi.info.json` is what yt-dlp extracted for one Bilibili video when the
household read it through its own proxy: the title, uploader, description, duration,
cover, and formats, trimmed to what medleyplay reads. The signed media URLs are
replaced by `https://example.invalid/<format id>`, so nothing in it is fetched.

MusicBrainz answers (MusicBrainz data is CC0, free to copy):

- `latin-search.json`: the real answer to a recording search for *Let Down* by
  *Radiohead*, as the web service gave it: two recordings, on 55 and 2 releases.
- `latin-release.json`: the real answer to a release lookup with
  `inc=recordings+artist-credits+media`, the 2016 reissue of *OK Computer*, which says
  it has no front cover.
- `cjk-release-search.json`: made by hand in the shape of MusicBrainz's release search;
  the album 生如夏花 by 朴树 as its 2003 original and a 2013 reissue, and a compilation
  that scores lower.
- `cjk-release.json`: made by hand in the shape of a release lookup; the 2003 original,
  with 11 songs whose titles after the first are made up, and a front cover.

The two made by hand exist because the live answer for the Chinese album was not
saved; nothing in this folder was fetched by the tests.
"""

import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any, Final

RECORDINGS: Final = Path(__file__).parent


def recorded_info(video: str) -> Mapping[str, object]:
    """Return yt-dlp's recorded info for the Bilibili `video`, as a new copy each time."""
    info = json.loads((RECORDINGS / f"{video}.info.json").read_text(encoding="utf-8"))
    if not isinstance(info, dict):
        message = f"The recording of {video} isn't a JSON object."
        raise TypeError(message)
    return info


def recorded_answer(name: str) -> dict[str, Any]:
    """Return the recorded MusicBrainz answer `name`, such as `latin-search`, as a new copy.

    The answer is JSON of a shape only the service decides, so a test may change any part.
    """
    answer = json.loads((RECORDINGS / f"{name}.json").read_text(encoding="utf-8"))
    if not isinstance(answer, dict):
        message = f"The recording {name} isn't a JSON object."
        raise TypeError(message)
    return answer
