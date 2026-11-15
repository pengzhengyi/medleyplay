"""The plugin `wikipedia`: what Wikimedia's sites know, here an artist's names and photo.

It is asked only when the core asks for an artist's names, and asks Wikidata and
Wikimedia Commons for at most one request a second.
"""

from medleyplay.plugin_api import ARTIST_NAME_FINDER, Plugin, Registry
from medleyplay.plugins.wikipedia.names import WikidataNames


def register(registry: Registry) -> None:
    """Add the artist name finder `wikipedia`."""
    registry.add(ARTIST_NAME_FINDER, "wikipedia", WikidataNames())


plugin = Plugin(api_version=1, register=register)
