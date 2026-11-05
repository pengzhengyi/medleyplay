"""The plugin `musicbrainz`: a Track's release and cover, found on MusicBrainz.

It is asked only when someone asks the core to find a Track on MusicBrainz, and it
asks MusicBrainz for at most one request a second.
"""

from medleyplay.plugin_api import TRACK_ENRICHER, Plugin, Registry
from medleyplay.plugins.musicbrainz.provider import MusicBrainz


def register(registry: Registry) -> None:
    """Add the enricher `musicbrainz`."""
    registry.add(TRACK_ENRICHER, "musicbrainz", MusicBrainz())


plugin = Plugin(api_version=1, register=register)
