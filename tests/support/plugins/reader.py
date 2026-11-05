"""A plugin that answers for the enrichers `bilibili-details` and `musicbrainz` with scripts.

For `bilibili-details`, the video id says how the plugin answers:

| Video | Answers |
| --- | --- |
| `BV1AC4y1L7Yi` | the recorded video's text, and a cover |
| `BVNoCover` | the text of *Night Drive* by *Blue Room*, and no cover |
| `BVNotAnImage` | text, and a cover file that holds no image |
| `BVEscape` | text, and a cover named outside its folder |
| `BVLink` | text, and a cover that is a link to another file |
| `BVHuge` | text, and a cover one byte over the limit |
| `BVFolder` | text, and a cover that is a folder |
| `BVValues` | the genre *Vocaloid* and the year 2014 as values, with a cover |
| `BVBadValues` | a year that is not a year |
| `BVGone` | gone |
| `BVRefused` | refused |
| `BVDown` | a `NetworkError` |
| `BVBroken` | a fault |
| `BVSlow` | text, after two seconds |
| `BVProxyEcho` | text titled with the proxy it was asked through |

For `musicbrainz`, the title the Track shows says how it answers, or its album for a
long file split into songs:

| Title | Answers |
| --- | --- |
| `Nowhere` | no values |
| `Refused` | refused |
| `Down` | a `NetworkError` |
| `Broken` | a fault |
| `BadValues` | a year that is not a year |
| `NoCover` | the values of a song, and no cover |
| `Remaster` | the values of a song titled *Remaster (2016)* |
| `Echo` | the album *echo*, naming how it was asked |
| `生如夏花` (a long file) | the album, album artist, year, and a cover |
| any other | the values of *Let Down* on *OK Computer*, and a cover |
"""

import time
from pathlib import Path
from typing import Final

from medleyplay.plugin_api import (
    TRACK_ENRICHER,
    Chapter,
    Enriched,
    EnrichStatus,
    EnrichTrack,
    NetworkError,
    Plugin,
    Registry,
    VideoText,
)
from tests.support.images import jpeg_image, oversized_jpeg

RECORDED_TITLE: Final = "【HR 24/48】朴树2003《生如夏花》专辑歌词版"


class Reader:
    """Answers each scripted video as the table says."""

    def enrich(self, request: EnrichTrack) -> Enriched:
        video, folder = request.video or "", Path(request.folder)
        match video:
            case "BVGone":
                return Enriched(status=EnrichStatus.GONE, message="The video was removed.")
            case "BVRefused":
                return Enriched(status=EnrichStatus.REFUSED, message="HTTP Error 412.")
            case "BVDown":
                message = "Bilibili couldn't be reached."
                raise NetworkError(message)
            case "BVBroken":
                message = "The page changed."
                raise ValueError(message)
            case "BVBadValues":
                return Enriched(values={"year": "last year"})
            case "BVValues":
                return Enriched(
                    values={"genre": "Vocaloid", "year": 2014}, cover=_cover(folder, video)
                )
        if video == "BVSlow":
            time.sleep(2)
        title = f"proxy={request.proxy or 'none'}" if video == "BVProxyEcho" else _title(video)
        return Enriched(video_text=_text(title, video), cover=_cover_of(folder, video))


class Finder:
    """Answers each scripted Track as the table says."""

    def enrich(self, request: EnrichTrack) -> Enriched:
        shown = {each.field: each.value for each in request.shown}
        folder = Path(request.folder)
        key = str(shown.get("album" if request.whole_album else "title", ""))
        match key:
            case "Nowhere":
                return Enriched()
            case "Refused":
                return Enriched(status=EnrichStatus.REFUSED, message="HTTP Error 403.")
            case "Down":
                message = "MusicBrainz couldn't be reached."
                raise NetworkError(message)
            case "Broken":
                message = "The answer changed shape."
                raise ValueError(message)
            case "BadValues":
                return Enriched(values={"year": "last year"})
            case "Echo":
                return Enriched(values={"album": _echo(request, shown)})
        if request.whole_album:
            values: dict[str, str | int] = {"album": key, "album_artist": "朴树", "year": 2003}
            return Enriched(values=values, cover=_cover(folder, key))
        title = "Remaster (2016)" if key == "Remaster" else key
        values = {
            "title": title,
            "artist": "Radiohead",
            "album": "OK Computer",
            "album_artist": "Radiohead",
            "year": 1997,
            "track_number": 5,
            "disc_number": 1,
        }
        return Enriched(values=values, cover=None if key == "NoCover" else _cover(folder, key))


def _echo(request: EnrichTrack, shown: dict[str, str | int]) -> str:
    return (
        f"whole_album={request.whole_album} video={request.video} proxy={request.proxy or 'none'}"
        f" duration={request.duration_ms} file={request.file_name or 'none'}"
        f" shown={sorted(shown)}"
    )


def _title(video: str) -> str:
    return RECORDED_TITLE if video == "BV1AC4y1L7Yi" else "Night Drive / Blue Room"


def _text(title: str, video: str) -> VideoText:
    chapters = (Chapter(start_ms=0, title="Night Drive"),) if video == "BVSlow" else ()
    return VideoText(title=title, description="-", chapters=chapters)


def _cover_of(folder: Path, video: str) -> str | None:
    if video == "BVNoCover":
        return None
    if video == "BVEscape":
        return "../cover"
    cover = folder / "cover"
    match video:
        case "BVNotAnImage":
            cover.write_text("not an image", encoding="utf-8")
        case "BVLink":
            cover.symlink_to("/etc/hosts")
        case "BVFolder":
            cover.mkdir()
        case "BVHuge":
            cover.write_bytes(oversized_jpeg())
        case _:
            return _cover(folder, video)
    return cover.name


def _cover(folder: Path, video: str) -> str:
    (folder / "cover").write_bytes(jpeg_image(video))
    return "cover"


def register(registry: Registry) -> None:
    """Add the enrichers `bilibili-details` and `musicbrainz`."""
    registry.add(TRACK_ENRICHER, "bilibili-details", Reader())
    registry.add(TRACK_ENRICHER, "musicbrainz", Finder())


plugin = Plugin(api_version=1, register=register)
