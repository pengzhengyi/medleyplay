"""The plugin registers its enricher, choosers, describer, image suggester, and fetcher."""

from medleyplay.plugin_host.loader import BUILT_IN_PLUGINS, load_plugins, plugin_names


def test_the_plugin_is_listed_among_the_built_in_plugins() -> None:
    assert "ai-details" in plugin_names(BUILT_IN_PLUGINS)


def test_the_plugin_answers_each_of_its_operations_for_the_key_ai_details() -> None:
    endpoints = load_plugins(BUILT_IN_PLUGINS, ["ai-details"], lambda _: None)

    assert sorted(endpoints) == [
        ("artist_chooser", "ai-details", "choose"),
        ("artist_describer", "ai-details", "describe"),
        ("cover_chooser", "ai-details", "choose"),
        ("image_fetcher", "ai-details", "fetch"),
        ("image_suggester", "ai-details", "suggest"),
        ("picture_chooser", "ai-details", "choose"),
        ("track_enricher", "ai-details", "enrich"),
    ]
