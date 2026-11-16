"""The plugin `musicbrainz`: a Track's release, the artists of a name, and an album's covers.

It is asked only when someone asks the core to find a Track, an artist, or covers on
MusicBrainz, and it asks MusicBrainz for at most one request a second.
"""

from medleyplay.plugin_api import ARTIST_FINDER, COVER_FINDER, TRACK_ENRICHER, Plugin, Registry
from medleyplay.plugins.musicbrainz.artists import MusicBrainzArtists
from medleyplay.plugins.musicbrainz.covers import MusicBrainzCovers
from medleyplay.plugins.musicbrainz.provider import MusicBrainz


def register(registry: Registry) -> None:
    """Add the enricher, the artist finder, and the cover finder `musicbrainz`."""
    registry.add(TRACK_ENRICHER, "musicbrainz", MusicBrainz())
    registry.add(ARTIST_FINDER, "musicbrainz", MusicBrainzArtists())
    registry.add(COVER_FINDER, "musicbrainz", MusicBrainzCovers())


plugin = Plugin(api_version=1, register=register)
