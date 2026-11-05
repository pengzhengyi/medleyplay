"""The plugin registers its enricher under its own name, apart from `bilibili`."""

from medleyplay.plugin_host.loader import BUILT_IN_PLUGINS, load_plugins, plugin_names


def test_the_plugin_is_its_own_apart_from_the_bilibili_plugin() -> None:
    names = plugin_names(BUILT_IN_PLUGINS)

    assert {"bilibili", "bilibili-details"} <= set(names)


def test_the_plugin_answers_the_enrich_operation_for_the_key_bilibili_details() -> None:
    endpoints = load_plugins(BUILT_IN_PLUGINS, ["bilibili-details"], lambda _: None)

    assert list(endpoints) == [("track_enricher", "bilibili-details", "enrich")]
