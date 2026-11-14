"""The plugin registers its enricher and its artist finder under the key `musicbrainz`."""

from medleyplay.plugin_host.loader import BUILT_IN_PLUGINS, load_plugins, plugin_names


def test_the_plugin_is_listed_among_the_built_in_plugins() -> None:
    assert "musicbrainz" in plugin_names(BUILT_IN_PLUGINS)


def test_the_plugin_answers_enrich_and_find_artist_for_the_key_musicbrainz() -> None:
    endpoints = load_plugins(BUILT_IN_PLUGINS, ["musicbrainz"], lambda _: None)

    assert list(endpoints) == [
        ("track_enricher", "musicbrainz", "enrich"),
        ("artist_finder", "musicbrainz", "find"),
    ]
