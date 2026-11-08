"""Which community rating a song shows, and which links to it are trusted."""

import pytest

from medleyplay.domain.community import (
    MIN_VOTES,
    CommunityRating,
    RatedAs,
    link_is_on,
    shown_rating,
)

SONG_PAGE = "https://musicbrainz.org/recording/47b02a82"
ALBUM_PAGE = "https://musicbrainz.org/release-group/b1392450"


def _song(value: float, votes: int) -> CommunityRating:
    """What MusicBrainz's listeners rated the song itself."""
    return CommunityRating("musicbrainz", RatedAs.SONG, value, votes, SONG_PAGE)


def _album(value: float, votes: int) -> CommunityRating:
    """What MusicBrainz's listeners rated the song's album."""
    return CommunityRating("musicbrainz", RatedAs.ALBUM, value, votes, ALBUM_PAGE)


def test_a_song_rated_by_enough_listeners_shows_its_own_rating() -> None:
    assert shown_rating([_album(4.55, 89), _song(4.2, 24)]) == _song(4.2, 24)


def test_a_song_rated_by_too_few_shows_its_albums_rating() -> None:
    assert shown_rating([_song(5, MIN_VOTES - 1), _album(3.5, 12)]) == _album(3.5, 12)


def test_a_song_whose_album_too_few_rated_either_shows_none() -> None:
    assert shown_rating([_song(5, 2), _album(1, 1)]) is None


def test_a_song_nobody_rated_shows_none() -> None:
    assert shown_rating([]) is None


@pytest.mark.parametrize(
    ("link", "on"),
    [
        ("https://musicbrainz.org/recording/47b02a82", True),
        ("https://MusicBrainz.org/release-group/b1392450", True),
        ("http://musicbrainz.org/recording/47b02a82", False),
        ("https://musicbrainz.org.example/recording/47b02a82", False),
        ("https://user@evil.example/?musicbrainz.org", False),
        ("javascript:alert(1)", False),
        ("", False),
    ],
)
def test_a_link_is_trusted_only_over_https_to_the_sources_own_host(link: str, *, on: bool) -> None:
    assert link_is_on(link, frozenset({"musicbrainz.org"})) is on
