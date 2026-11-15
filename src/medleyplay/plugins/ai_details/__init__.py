"""The plugin `ai-details`: suggests a Track's details, and how to name an artist, with AI.

It is asked only when someone asks the core to suggest a Track's details, one Track at
a time, to recommend artists for the Library's names, or to suggest an artist's name and
a note about it, and it asks the providers the
household set up. What it answers is only a suggestion.
"""

from medleyplay.plugin_api import ARTIST_CHOOSER, ARTIST_DESCRIBER, TRACK_ENRICHER, Plugin, Registry
from medleyplay.plugins.ai_details.artists import AiArtistChooser
from medleyplay.plugins.ai_details.describe import AiArtistDescriber
from medleyplay.plugins.ai_details.provider import AiDetails


def register(registry: Registry) -> None:
    """Add the enricher `ai-details`, and the artist chooser and describer of the same name."""
    registry.add(TRACK_ENRICHER, "ai-details", AiDetails())
    registry.add(ARTIST_CHOOSER, "ai-details", AiArtistChooser())
    registry.add(ARTIST_DESCRIBER, "ai-details", AiArtistDescriber())


plugin = Plugin(api_version=1, register=register)
