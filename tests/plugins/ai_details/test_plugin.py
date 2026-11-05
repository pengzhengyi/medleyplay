"""The plugin registers its enricher under the key `ai-details`, apart from the site ones."""

from medleyplay.plugin_host.loader import BUILT_IN_PLUGINS, load_plugins, plugin_names


def test_the_plugin_is_listed_among_the_built_in_plugins() -> None:
    assert "ai-details" in plugin_names(BUILT_IN_PLUGINS)


def test_the_plugin_answers_the_enrich_operation_for_the_key_ai_details() -> None:
    endpoints = load_plugins(BUILT_IN_PLUGINS, ["ai-details"], lambda _: None)

    assert list(endpoints) == [("track_enricher", "ai-details", "enrich")]
