"""Identify provider selections that cannot be replayed automatically."""

from dataclasses import dataclass
from enum import StrEnum
from typing import Final
from urllib.parse import urlsplit

from medleyplay.bilibili_links import canonical_video_id
from medleyplay.domain.links import BILIBILI_SOURCE, lookup_link

NO_AUTOMATIC_RETRY: Final = frozenset({"retry_exhausted", "route_changed", "backend_changed"})


class HoldReason(StrEnum):
    """Why further provider requests for a selection must stop."""

    REFUSED = "provider_refused"
    UNKNOWN = "response_unknown"
    UNCERTAIN = "attempt_uncertain"


@dataclass(frozen=True)
class DownloadHoldKey:
    """A provider's video, individual part, or unresolved short link."""

    site: str
    video: str = ""
    short: str = ""
    part: int = 0

    @property
    def subject(self) -> str:
        """Return the namespaced identity stored with the Hold."""
        if self.short:
            return f"short:{self.short}"
        video = canonical_video_id(self.video) if self.site == BILIBILI_SOURCE else self.video
        return f"video:{video}"


@dataclass(frozen=True)
class DownloadSelection:
    """A provider selection whose parts may overlap earlier requests."""

    site: str
    video: str = ""
    parts: tuple[int, ...] = ()
    short: str = ""

    @classmethod
    def from_link(cls, link: str) -> "DownloadSelection":
        """Use only the canonical path of a validated public Bilibili link."""
        url = urlsplit(lookup_link(link))
        if url.hostname == "b23.tv":
            return cls(BILIBILI_SOURCE, short=url.path[1:])
        video = url.path.rsplit("/", 1)[-1]
        return cls(BILIBILI_SOURCE, video=canonical_video_id(video))

    def key(self, part: int = 0) -> DownloadHoldKey:
        """Scope a Hold to a known part, or to the whole known identity."""
        return DownloadHoldKey(self.site, video=self.video, short=self.short, part=part)
