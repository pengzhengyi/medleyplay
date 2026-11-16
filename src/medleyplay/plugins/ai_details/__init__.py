"""The plugin `ai-details`: suggests a Track's details, and how to name an artist, with AI.

It is asked only when someone asks the core to suggest a Track's details, one Track at
a time, to recommend artists for the Library's names, to suggest an artist's name and
a note about it, or to choose which release of an album is the album's, and it asks the
providers the household set up. What it answers is only a suggestion.
"""

from medleyplay.plugin_api import (
    ARTIST_CHOOSER,
    ARTIST_DESCRIBER,
    COVER_CHOOSER,
    TRACK_ENRICHER,
    Plugin,
    Registry,
)
from medleyplay.plugins.ai_details.artists import AiArtistChooser
from medleyplay.plugins.ai_details.covers import AiCoverChooser
from medleyplay.plugins.ai_details.describe import AiArtistDescriber
from medleyplay.plugins.ai_details.provider import AiDetails


def register(registry: Registry) -> None:
    """Add the enricher `ai-details`, and the artist and cover choosers of the same name."""
    registry.add(TRACK_ENRICHER, "ai-details", AiDetails())
    registry.add(ARTIST_CHOOSER, "ai-details", AiArtistChooser())
    registry.add(ARTIST_DESCRIBER, "ai-details", AiArtistDescriber())
    registry.add(COVER_CHOOSER, "ai-details", AiCoverChooser())


plugin = Plugin(api_version=1, register=register)
