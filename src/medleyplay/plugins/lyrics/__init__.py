"""The plugin `lyrics`: a song's lyrics, found on LRCLIB, and on NetEase when turned on.

It is asked about the songs coming up, or when someone asks. LRCLIB is asked first;
NetEase Cloud Music only for a song LRCLIB has no lyrics for, and only once the
household has turned it on.
"""

from medleyplay.plugin_api import (
    TRACK_ENRICHER,
    Enriched,
    EnrichStatus,
    EnrichTrack,
    LyricsProvider,
    Plugin,
    Registry,
)
from medleyplay.plugins.lyrics.lrclib import Lrclib
from medleyplay.plugins.lyrics.netease import Netease


class LyricsSites:
    """Asks LRCLIB for a song's lyrics, then the sites the household turned on, in turn."""

    def __init__(self, lrclib: Lrclib, netease: Netease) -> None:
        """Ask `lrclib` first, and `netease` when it is turned on."""
        self._lrclib = lrclib
        self._sites = {LyricsProvider.NETEASE: netease}

    def enrich(self, request: EnrichTrack) -> Enriched:
        """Answer the first lyrics a site has, or the first refusal or failure."""
        answer = self._lrclib.enrich(request)
        for site in request.lyrics_sites:
            if answer.status is not EnrichStatus.OK or answer.lyrics is not None:
                break
            asked = self._sites.get(site)
            if asked is not None:
                answer = asked.enrich(request)
        return answer


def register(registry: Registry) -> None:
    """Add the enricher `lyrics`."""
    registry.add(TRACK_ENRICHER, "lyrics", LyricsSites(Lrclib(), Netease()))


plugin = Plugin(api_version=1, register=register)
