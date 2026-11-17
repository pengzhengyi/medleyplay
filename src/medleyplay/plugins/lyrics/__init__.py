"""The plugin `lyrics`: a song's lyrics, found on LRCLIB.

It is asked about the songs coming up, or when someone asks, and asks LRCLIB once a
second at most.
"""

from medleyplay.plugin_api import TRACK_ENRICHER, Plugin, Registry
from medleyplay.plugins.lyrics.lrclib import Lrclib


def register(registry: Registry) -> None:
    """Add the enricher `lyrics`."""
    registry.add(TRACK_ENRICHER, "lyrics", Lrclib())


plugin = Plugin(api_version=1, register=register)
