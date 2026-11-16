"""The cover finder: the front covers of an album's releases on MusicBrainz, best first."""

from pathlib import Path
from typing import Any

import pytest

from medleyplay.plugin_api import MAX_COVERS, FindCovers, FindStatus, NetworkError
from medleyplay.plugins.musicbrainz.client import MusicBrainzClient
from medleyplay.plugins.musicbrainz.covers import MAX_TRIED, MusicBrainzCovers
from tests.support.images import jpeg_image
from tests.support.musicbrainz import API, COVERS, SHU_PU, FakeMusicBrainz, MusicBrainzFactory
from tests.support.transport import FakeWaits, Reply

LATER = "5e6f7a8b-9c0d-4e1f-a2b3-c4d5e6f7a8b9"
"""The 2013 reissue of 生如夏花 in the hand-made search."""
BEST_OF = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"
"""朴树精选, which the hand-made search scores 71."""


def cover_url(release: str) -> str:
    return f"{COVERS}/release/{release}/front-500"


def holding(fake: FakeMusicBrainz, release: str, image: bytes) -> FakeMusicBrainz:
    """Return `fake` with the archive holding `image` as the front cover of `release`."""
    return fake.answer(
        cover_url(release), Reply.redirect(f"https://archive.org/{release}.jpg")
    ).answer(f"https://archive.org/{release}.jpg", Reply(200, {}, image))


def shu_pu_covers() -> FakeMusicBrainz:
    """A MusicBrainz finding 生如夏花's 2003 original and its 2013 reissue, each with a cover.

    ```text
    /release              生如夏花 2003 (100), 生如夏花 2013 (100), 朴树精选 (71)
    2003 front-500        a JPEG of "2003"
    2013 front-500        a JPEG of "2013"
    ```
    """
    fake = FakeMusicBrainz().answer(
        f"{API}/release", Reply.json(MusicBrainzFactory.shu_pu_search())
    )
    return holding(holding(fake, SHU_PU, jpeg_image("2003")), LATER, jpeg_image("2013"))


def many_releases(count: int) -> dict[str, Any]:
    """A release search for *Live* answering `count` releases, each scoring 100, by year."""
    return {
        "releases": [
            {
                "id": f"00000000-0000-4000-8000-{index:012d}",
                "score": 100,
                "title": "Live",
                "status": "Official",
                "date": str(1970 + index),
            }
            for index in range(count)
        ]
    }


def finder_of(fake: FakeMusicBrainz) -> MusicBrainzCovers:
    waits = FakeWaits()
    return MusicBrainzCovers(
        MusicBrainzClient(fake.session(), sleep=waits.sleep, clock=waits.clock)
    )


def test_the_covers_of_the_albums_releases_come_best_first_each_written_with_what_tells_it_apart(
    tmp_path: Path,
) -> None:
    found = finder_of(shu_pu_covers()).find(
        FindCovers(album="生如夏花", artist="朴树", folder=str(tmp_path))
    )

    assert [
        (cover.release_id, cover.date, cover.country, cover.format, cover.tracks, cover.artist)
        for cover in found.covers
    ] == [
        (SHU_PU, "2003-08-01", "CN", "CD", 11, "朴树"),
        (LATER, "2013-06-21", "CN", "CD", 11, "朴树"),
    ]
    assert [(tmp_path / cover.file).read_bytes() for cover in found.covers] == [
        jpeg_image("2003"),
        jpeg_image("2013"),
    ]


def test_a_release_scoring_below_a_match_is_not_asked_for_its_cover(tmp_path: Path) -> None:
    fake = shu_pu_covers()

    finder_of(fake).find(FindCovers(album="生如夏花", artist="朴树", folder=str(tmp_path)))

    assert cover_url(BEST_OF) not in fake.urls()


def test_the_album_and_its_artist_are_searched_for(tmp_path: Path) -> None:
    fake = shu_pu_covers()

    finder_of(fake).find(FindCovers(album="生如夏花", artist="朴树", folder=str(tmp_path)))

    assert fake.parameter("query") == 'release:"生如夏花" AND artist:"朴树"'


def test_an_album_with_no_artist_is_searched_for_by_its_name_alone(tmp_path: Path) -> None:
    fake = shu_pu_covers()

    finder_of(fake).find(FindCovers(album="生如夏花", folder=str(tmp_path)))

    assert fake.parameter("query") == 'release:"生如夏花"'


def test_a_release_the_archive_has_no_cover_of_is_left_out(tmp_path: Path) -> None:
    fake = shu_pu_covers().answer(cover_url(SHU_PU), Reply(404))

    found = finder_of(fake).find(FindCovers(album="生如夏花", artist="朴树", folder=str(tmp_path)))

    assert [cover.release_id for cover in found.covers] == [LATER]


def test_a_cover_two_releases_share_is_offered_once(tmp_path: Path) -> None:
    fake = holding(shu_pu_covers(), LATER, jpeg_image("2003"))

    found = finder_of(fake).find(FindCovers(album="生如夏花", artist="朴树", folder=str(tmp_path)))

    assert [cover.release_id for cover in found.covers] == [SHU_PU]


def test_no_more_than_the_most_covers_are_offered(tmp_path: Path) -> None:
    fake = FakeMusicBrainz().answer(f"{API}/release", Reply.json(many_releases(MAX_COVERS + 2)))
    for index in range(MAX_COVERS + 2):
        release = f"00000000-0000-4000-8000-{index:012d}"
        holding(fake, release, jpeg_image(f"Live {index}"))

    found = finder_of(fake).find(FindCovers(album="Live", folder=str(tmp_path)))

    assert len(found.covers) == MAX_COVERS


def test_no_more_releases_are_tried_than_the_most(tmp_path: Path) -> None:
    fake = FakeMusicBrainz().answer(f"{API}/release", Reply.json(many_releases(MAX_TRIED + 3)))
    for index in range(MAX_TRIED + 3):
        fake.answer(cover_url(f"00000000-0000-4000-8000-{index:012d}"), Reply(404))

    found = finder_of(fake).find(FindCovers(album="Live", folder=str(tmp_path)))

    assert found.covers == ()
    assert sum(url.startswith(COVERS) for url in fake.urls()) == MAX_TRIED


def test_musicbrainz_refusing_the_search_is_a_refusal(tmp_path: Path) -> None:
    fake = FakeMusicBrainz().answer(f"{API}/release", Reply(403))

    found = finder_of(fake).find(FindCovers(album="生如夏花", artist="朴树", folder=str(tmp_path)))

    assert found.status is FindStatus.REFUSED


def test_the_archive_failing_fails_the_find_so_it_is_asked_again(tmp_path: Path) -> None:
    fake = shu_pu_covers().answer(cover_url(SHU_PU), Reply(503))

    with pytest.raises(NetworkError):
        finder_of(fake).find(FindCovers(album="生如夏花", artist="朴树", folder=str(tmp_path)))
