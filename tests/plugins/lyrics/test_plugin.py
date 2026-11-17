"""The plugin registers its enricher as `lyrics`."""

from medleyplay.plugin_host.loader import BUILT_IN_PLUGINS, load_plugins, plugin_names


def test_the_plugin_is_listed_among_the_built_in_plugins() -> None:
    assert "lyrics" in plugin_names(BUILT_IN_PLUGINS)


def test_the_plugin_answers_enrich_for_the_key_lyrics() -> None:
    endpoints = load_plugins(BUILT_IN_PLUGINS, ["lyrics"], lambda _: None)

    assert list(endpoints) == [("track_enricher", "lyrics", "enrich")]
