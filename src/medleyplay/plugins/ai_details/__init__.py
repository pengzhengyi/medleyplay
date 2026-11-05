"""The plugin `ai-details`: suggests a Track's details from its video text with an AI model.

It is asked only when someone asks the core to suggest a Track's details, and it asks
the provider the household set up, one Track at a time. What it answers is only a
suggestion.
"""

from medleyplay.plugin_api import TRACK_ENRICHER, Plugin, Registry
from medleyplay.plugins.ai_details.provider import AiDetails


def register(registry: Registry) -> None:
    """Add the enricher `ai-details`."""
    registry.add(TRACK_ENRICHER, "ai-details", AiDetails())


plugin = Plugin(api_version=1, register=register)
