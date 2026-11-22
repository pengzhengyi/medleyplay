"""The song nearest a Track among those a search found, and the song a video's title names."""

from dataclasses import replace

import pytest

from medleyplay.plugins.lyrics.nearest import Candidate, nearest, song_title_of


@pytest.mark.parametrize(
    ("title", "artist", "song"),
    [
        ("Melt", "ryo", "Melt"),
        ("【周杰伦】晴天 官方MV", "周杰伦", "晴天"),
        ("周杰伦《晴天》Official MV", "周杰伦", "晴天"),
        ("米津玄師 MV「Lemon」", "米津玄師", "Lemon"),
        ("Taylor Swift - Shake It Off (Official Music Video)", "Taylor Swift", "Shake It Off"),
        ("Night Drive (Live)", "Blue Room", "Night Drive (Live)"),
        ("[4K] Night Drive [高音质]", "Blue Room", "Night Drive"),
    ],
)
def test_the_song_a_title_names_is_found_in_a_videos_words(
    title: str, artist: str, song: str
) -> None:
    assert song_title_of(title, artist) == song


MELT = Candidate(title="Melt", artist="ryo", seconds=260.0)
"""*Melt* by ryo, 4:20 long, as a search found it."""


def test_the_nearest_song_is_by_the_artist_then_of_the_exact_title_then_the_closest_in_length() -> (
    None
):
    found = [
        replace(MELT, artist="Someone", seconds=260.5),
        replace(MELT, title="Melt (Remix)", seconds=260.0),
        replace(MELT, seconds=266.0),
        replace(MELT, seconds=263.0),
    ]

    assert nearest(found, "Melt", "ryo", 260.4) == found[3]


@pytest.mark.parametrize(
    ("candidate", "why"),
    [
        (replace(MELT, seconds=269.0), "more than eight seconds longer"),
        (replace(MELT, title="Melting Point"), "another title"),
        (replace(MELT, artist="Someone", seconds=263.0), "another artist, three seconds longer"),
        (replace(MELT, seconds=None), "no known length"),
    ],
)
def test_a_song_too_far_from_the_track_is_none(candidate: Candidate, why: str) -> None:
    assert nearest([candidate], "Melt", "ryo", 260.4) is None, why


def test_another_artists_song_of_the_title_is_near_when_as_long_as_the_track() -> None:
    other = replace(MELT, artist="Someone", seconds=261.0)

    assert nearest([other], "Melt", "ryo", 260.4) == other


def test_a_track_of_no_known_length_takes_only_the_artists_song_of_the_title() -> None:
    found = [replace(MELT, artist="Someone"), replace(MELT, title="melt!", seconds=300.0)]

    assert nearest(found, "Melt", "ryo", None) == found[1]


def test_one_of_several_artists_the_track_names_is_its_artist() -> None:
    found = [replace(MELT, artist="ryo (supercell)", seconds=266.0)]

    assert nearest(found, "Melt", "初音ミク / ryo", 260.4) == found[0]
