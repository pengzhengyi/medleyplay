"""The plugin `deezer`: pictures of an artist, found on Deezer.

It is asked only when the household has turned Deezer on in Settings, for the artist
whose photo is being chosen.
"""

from medleyplay.plugin_api import PICTURE_FINDER, Plugin, Registry
from medleyplay.plugins.deezer.pictures import DeezerPictures


def register(registry: Registry) -> None:
    """Add the picture finder `deezer`."""
    registry.add(PICTURE_FINDER, "deezer", DeezerPictures())


plugin = Plugin(api_version=1, register=register)
