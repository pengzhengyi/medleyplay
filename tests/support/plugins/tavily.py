"""A picture search provider with one test credential and one source-linked result."""

import sys

from medleyplay.plugin_api import Plugin, Registry
from medleyplay.plugin_api.image_search import (
    IMAGE_SEARCHER,
    PictureCandidate,
    PictureResults,
    SearchPictures,
)


class FixtureSearch:
    """Answer without contacting a site."""

    def search(self, request: SearchPictures) -> PictureResults:
        """Only answer when the search key reached this plugin alone."""
        if (
            request.key.get_secret_value() != "fixture-key"
            or "tests.support.plugins.reader" in sys.modules
        ):
            message = "The fixture did not get an isolated credential."
            raise ValueError(message)
        return PictureResults(
            images=(
                PictureCandidate(
                    url="https://label.example/cover.jpg",
                    page="https://label.example/releases",
                    title=request.album,
                ),
            )
        )


def register(registry: Registry) -> None:
    """Register the fake search provider."""
    registry.add(IMAGE_SEARCHER, "tavily", FixtureSearch())


plugin = Plugin(api_version=1, register=register)
