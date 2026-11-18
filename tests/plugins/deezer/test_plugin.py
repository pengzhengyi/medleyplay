"""The plugin registers its picture finder as `deezer`."""

from medleyplay.plugin_host.loader import BUILT_IN_PLUGINS, load_plugins, plugin_names


def test_the_plugin_is_listed_among_the_built_in_plugins() -> None:
    assert "deezer" in plugin_names(BUILT_IN_PLUGINS)


def test_the_plugin_answers_find_for_the_key_deezer() -> None:
    endpoints = load_plugins(BUILT_IN_PLUGINS, ["deezer"], lambda _: None)

    assert list(endpoints) == [("picture_finder", "deezer", "find")]
