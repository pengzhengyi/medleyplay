"""The plugin `lyrics`: a song's lyrics, found on LRCLIB, and on NetEase when turned on.

It is asked about the songs coming up, or when someone asks. LRCLIB is asked first;
NetEase Cloud Music only for a song LRCLIB has no lyrics for, and only once the
household has turned it on. Looking for lyrics by hand, the household is offered the
songs each site finds of a title and artist, LRCLIB's first.
"""

from medleyplay.plugin_api import (
    LYRICS_FINDER,
    MAX_LYRICS_FOUND,
    TRACK_ENRICHER,
    Enriched,
    EnrichStatus,
    EnrichTrack,
    FindLyrics,
    FindStatus,
    FoundLyricsOptions,
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

    def find(self, request: FindLyrics) -> FoundLyricsOptions:
        """Answer the songs LRCLIB finds, then those of each site turned on, in turn.

        A site refusing is said so, and asked no more; what was found before is kept.
        """
        found = self._lrclib.find(request)
        options = list(found.options)
        for site in request.sites:
            asked = self._sites.get(site)
            if found.status is FindStatus.REFUSED or asked is None:
                continue
            found = asked.find(request)
            options += found.options
        return FoundLyricsOptions(
            status=found.status if not options else FindStatus.OK,
            message=found.message,
            options=tuple(options[:MAX_LYRICS_FOUND]),
        )


def register(registry: Registry) -> None:
    """Add the enricher `lyrics`, and the finder `lyrics` of the lyrics the sites have."""
    sites = LyricsSites(Lrclib(), Netease())
    registry.add(TRACK_ENRICHER, "lyrics", sites)
    registry.add(LYRICS_FINDER, "lyrics", sites)


plugin = Plugin(api_version=1, register=register)
