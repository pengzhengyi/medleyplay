"""The plugin `bilibili-details`: a Track's video details and cover, read from Bilibili.

Its own plugin, apart from `bilibili`, so a fault in reading details never stops
Downloads. It is asked only when someone asks the core to find a Track's details.
"""

from medleyplay.plugin_api import TRACK_ENRICHER, Plugin, Registry
from medleyplay.plugins.bilibili_details.provider import BilibiliDetails


def register(registry: Registry) -> None:
    """Add the enricher `bilibili-details`."""
    registry.add(TRACK_ENRICHER, "bilibili-details", BilibiliDetails())


plugin = Plugin(api_version=1, register=register)
