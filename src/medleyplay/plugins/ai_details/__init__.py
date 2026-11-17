"""The plugin `ai-details`: suggests a Track's details, and how to name an artist, with AI.

It is asked only when someone asks the core to suggest a Track's details, one Track at
a time, to recommend artists for the Library's names, to suggest an artist's name and
a note about it, to choose which release of an album is the album's, or to suggest
links to a picture of an album or artist, and it asks the providers the household set
up. It fetches a picture only once someone approves a link it suggested. What it
answers is only a suggestion.
"""

from medleyplay.plugin_api import (
    ARTIST_CHOOSER,
    ARTIST_DESCRIBER,
    COVER_CHOOSER,
    IMAGE_FETCHER,
    IMAGE_SUGGESTER,
    TRACK_ENRICHER,
    Plugin,
    Registry,
)
from medleyplay.plugins.ai_details.artists import AiArtistChooser
from medleyplay.plugins.ai_details.covers import AiCoverChooser
from medleyplay.plugins.ai_details.describe import AiArtistDescriber
from medleyplay.plugins.ai_details.images import AiImageSuggester, WebImageFetcher
from medleyplay.plugins.ai_details.provider import AiDetails


def register(registry: Registry) -> None:
    """Add the enricher `ai-details`, and its choosers, image suggester, and fetcher."""
    registry.add(TRACK_ENRICHER, "ai-details", AiDetails())
    registry.add(ARTIST_CHOOSER, "ai-details", AiArtistChooser())
    registry.add(ARTIST_DESCRIBER, "ai-details", AiArtistDescriber())
    registry.add(COVER_CHOOSER, "ai-details", AiCoverChooser())
    registry.add(IMAGE_SUGGESTER, "ai-details", AiImageSuggester())
    registry.add(IMAGE_FETCHER, "ai-details", WebImageFetcher())


plugin = Plugin(api_version=1, register=register)
