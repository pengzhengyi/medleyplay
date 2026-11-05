"""Reading a video's details from yt-dlp's info, and naming the formats to download.

yt-dlp answers a video with several parts as a playlist whose entries are only
the parts' URLs, so only the first part is read in full; it names the uploader,
the formats, and its own part's title, as `<video title> p01 <part title>`.
"""

import math
import re
from collections.abc import Mapping, Sequence
from typing import Final
from urllib.parse import urlsplit

from medleyplay.plugin_api import (
    BEST_QUALITY,
    AudioQuality,
    Chapter,
    PartDetails,
    VideoDetails,
    VideoText,
)

type Info = Mapping[str, object]

QUALITIES: Final = {"30280": 192, "30232": 132, "30216": 64}
"""Bilibili's AAC audio ids and their bitrates in kbps, best first."""
VIDEO_URL: Final = "https://www.bilibili.com/video/{video}"
MAX_TEXT: Final = 512
MAX_VIDEO_TITLE: Final = 1_000
MAX_VIDEO_DESCRIPTION: Final = 20_000
MAX_CHAPTERS: Final = 1_000
MAX_CHAPTER_START_MS: Final = 7 * 24 * 3600 * 1000
COVER_HOSTS: Final = ("hdslb.com", "biliimg.com", "bilibili.com")
"""The sites Bilibili serves a video's cover from; an image anywhere else is no cover."""

_ANTHOLOGY_PART: Final = re.compile(r" p01 .*", re.DOTALL)


def video_url(video: str, part: int | None = None) -> str:
    """Return the URL yt-dlp reads a video, or one of its parts, from."""
    url = VIDEO_URL.format(video=video)
    return url if part is None else f"{url}?p={part}"


def video_details(first: Info, playlist: Info | None = None) -> VideoDetails:
    """Return a video's details from the info of its first part, and of the playlist, if any.

    A video with no AAC audio-only stream, such as an old one with only a muxed
    stream, has no qualities; the caller says why.
    """
    title = _text(playlist or first, "title")
    qualities = audio_qualities(first)
    count = len(_entries(playlist)) if playlist is not None else 1
    first_title = _text(first, "title").removeprefix(f"{title} p01 ") if playlist else title
    parts = [PartDetails(part=1, title=first_title or title, duration_ms=_duration_ms(first))]
    parts += [PartDetails(part=n, title=f"{title} P{n}") for n in range(2, count + 1)]
    return VideoDetails(
        title=title, uploader=_text(first, "uploader"), parts=tuple(parts), qualities=qualities
    )


def video_text(info: Info) -> VideoText:
    """Return the title, description, and chapters of a video from its info.

    A part of an anthology is titled `<video title> p01 <part title>` by yt-dlp; the
    video's own title is what the text holds.
    """
    title = _text(info, "title", limit=MAX_VIDEO_TITLE)
    if str(info.get("id", "")).endswith("_p1"):
        title = _ANTHOLOGY_PART.sub("", title, count=1)
    chapters = (_chapter(entry) for entry in _list(info.get("chapters")))
    return VideoText(
        title=title,
        description=_text(info, "description", limit=MAX_VIDEO_DESCRIPTION),
        chapters=tuple(chapter for chapter in chapters if chapter is not None)[:MAX_CHAPTERS],
    )


def cover_url(info: Info) -> str | None:
    """Return where the video's cover is, or `None` when it has none or is off Bilibili.

    "http://i2.hdslb.com/bfs/archive/ffd2.jpg" is a cover; the same path on another host is not.
    """
    url = info.get("thumbnail")
    if not isinstance(url, str):
        thumbnails = [t.get("url") for t in _list(info.get("thumbnails"))]
        url = thumbnails[-1] if thumbnails else None
    if not isinstance(url, str):
        return None
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    from_bilibili = any(host == known or host.endswith(f".{known}") for known in COVER_HOSTS)
    return url if parts.scheme in {"http", "https"} and from_bilibili else None


def audio_qualities(info: Info) -> tuple[AudioQuality, ...]:
    """Return the AAC audio-only qualities among a part's formats, best first."""
    found = {
        str(fmt.get("format_id"))
        for fmt in _list(info.get("formats"))
        if fmt.get("vcodec") == "none" and str(fmt.get("acodec") or "").startswith("mp4a")
    }
    return tuple(
        AudioQuality(id=quality, label=f"{kbps} kbps", kbps=kbps)
        for quality, kbps in QUALITIES.items()
        if quality in found
    )


def codecs(info: Info) -> str:
    """Return the audio codecs among a part's formats, to say why none can be served."""
    found = sorted({str(fmt.get("acodec")) for fmt in _list(info.get("formats"))} - {"none"})
    return ", ".join(found) or "none"


def formats_for(quality: str) -> str:
    """Return yt-dlp's format choice for `quality`: it, or the next best, down to the lowest."""
    ids = list(QUALITIES)
    start = 0 if quality == BEST_QUALITY else ids.index(quality)
    return "/".join(ids[start:])


def downloaded_file(info: Info) -> tuple[str, str | None]:
    """Return the downloaded file's path and the format id yt-dlp chose."""
    downloads = _list(info.get("requested_downloads"))
    path = downloads[0].get("filepath") if downloads else None
    if not isinstance(path, str):
        message = "yt-dlp didn't say where it downloaded the part."
        raise TypeError(message)
    format_id = info.get("format_id")
    return path, str(format_id) if format_id is not None else None


def _entries(playlist: Info) -> Sequence[Mapping[str, object]]:
    return _list(playlist.get("entries"))


def _list(value: object) -> list[Mapping[str, object]]:
    return [item for item in value if isinstance(item, Mapping)] if isinstance(value, list) else []


def _text(info: Info, key: str, limit: int = MAX_TEXT) -> str:
    value = info.get(key)
    return value.strip()[:limit] if isinstance(value, str) else ""


def _chapter(entry: Mapping[str, object]) -> Chapter | None:
    start, title = entry.get("start_time"), entry.get("title")
    if isinstance(start, bool) or not isinstance(start, int | float) or not isinstance(title, str):
        return None
    milliseconds = start * 1000
    if not math.isfinite(milliseconds) or not 0 <= milliseconds <= MAX_CHAPTER_START_MS:
        return None
    return Chapter(start_ms=round(milliseconds), title=title.strip()[:MAX_VIDEO_TITLE])


def _duration_ms(info: Info) -> int | None:
    seconds = info.get("duration")
    return round(seconds * 1000) if isinstance(seconds, int | float) and seconds >= 0 else None
