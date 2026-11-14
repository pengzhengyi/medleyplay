"""The plugin `musicbrainz`: a Track's release and cover, and the artists of a name.

It is asked only when someone asks the core to find a Track or an artist on
MusicBrainz, and it asks MusicBrainz for at most one request a second.
"""

from medleyplay.plugin_api import ARTIST_FINDER, TRACK_ENRICHER, Plugin, Registry
from medleyplay.plugins.musicbrainz.artists import MusicBrainzArtists
from medleyplay.plugins.musicbrainz.provider import MusicBrainz


def register(registry: Registry) -> None:
    """Add the enricher and the artist finder `musicbrainz`."""
    registry.add(TRACK_ENRICHER, "musicbrainz", MusicBrainz())
    registry.add(ARTIST_FINDER, "musicbrainz", MusicBrainzArtists())


plugin = Plugin(api_version=1, register=register)
