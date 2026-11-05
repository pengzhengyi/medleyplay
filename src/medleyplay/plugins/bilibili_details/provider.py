"""The enricher: reads a video's text and cover with yt-dlp, and sorts what the site answers."""

from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Final

from medleyplay.plugin_api import (
    MAX_COVER_BYTES,
    Enriched,
    EnrichStatus,
    EnrichTrack,
    is_cover_image,
)
from medleyplay.plugins.bilibili import _ytdlp
from medleyplay.plugins.bilibili.videos import cover_url, video_text, video_url

type Extract = Callable[..., tuple[_ytdlp.Info, bytes | None]]

COVER_NAME: Final = "cover"


@dataclass(frozen=True)
class BilibiliDetails:
    """Asks Bilibili for a video's title, description, chapters, and cover."""

    extract: Extract = field(default=_ytdlp.extract_with_image)

    def enrich(self, request: EnrichTrack) -> Enriched:
        """Read the video's text and write its cover into the request's folder.

        The site refusing the request, the video being removed, and a video that
        needs a login are answers, not failures; a network failure is raised.
        """
        try:
            info, image = self.extract(
                video_url(request.video),
                proxy=request.proxy,
                image_of=cover_url,
                max_bytes=MAX_COVER_BYTES,
            )
        except _ytdlp.RefusedError as error:
            return Enriched(status=EnrichStatus.REFUSED, message=str(error)[:512])
        except (_ytdlp.GoneError, _ytdlp.NeedsLoginError) as error:
            return Enriched(status=EnrichStatus.GONE, message=str(error)[:512])
        return Enriched(video_text=video_text(info), cover=_write_cover(image, request.folder))


def _write_cover(image: bytes | None, folder: str) -> str | None:
    if image is None or not is_cover_image(image):
        return None
    (Path(folder) / COVER_NAME).write_bytes(image)
    return COVER_NAME
