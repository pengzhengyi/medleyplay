"""The plugin registers its enricher, its artist chooser and describer, and its cover chooser."""

from medleyplay.plugin_host.loader import BUILT_IN_PLUGINS, load_plugins, plugin_names


def test_the_plugin_is_listed_among_the_built_in_plugins() -> None:
    assert "ai-details" in plugin_names(BUILT_IN_PLUGINS)


def test_the_plugin_answers_enrich_choose_and_describe_for_the_key_ai_details() -> None:
    endpoints = load_plugins(BUILT_IN_PLUGINS, ["ai-details"], lambda _: None)

    assert sorted(endpoints) == [
        ("artist_chooser", "ai-details", "choose"),
        ("artist_describer", "ai-details", "describe"),
        ("cover_chooser", "ai-details", "choose"),
        ("track_enricher", "ai-details", "enrich"),
    ]
