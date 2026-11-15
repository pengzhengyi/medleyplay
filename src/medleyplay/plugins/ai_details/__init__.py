"""The plugin `ai-details`: suggests a Track's details, and which artist a name names, with AI.

It is asked only when someone asks the core to suggest a Track's details, one Track at
a time, or to recommend artists for the Library's names, and it asks the providers the
household set up. What it answers is only a suggestion.
"""

from medleyplay.plugin_api import ARTIST_CHOOSER, TRACK_ENRICHER, Plugin, Registry
from medleyplay.plugins.ai_details.artists import AiArtistChooser
from medleyplay.plugins.ai_details.provider import AiDetails


def register(registry: Registry) -> None:
    """Add the enricher `ai-details`, and the artist chooser of the same name."""
    registry.add(TRACK_ENRICHER, "ai-details", AiDetails())
    registry.add(ARTIST_CHOOSER, "ai-details", AiArtistChooser())


plugin = Plugin(api_version=1, register=register)
