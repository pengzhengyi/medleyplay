"""A MusicBrainz and a Cover Art Archive that answer from a table, with no socket opened.

`FakeMusicBrainz` is a `requests` transport: the client under test sends its real
requests, and the fake answers each from the replies it was given for that URL (query
left out), then records what was sent.
"""

from collections.abc import Mapping
from typing import Any

from tests.support.images import jpeg_image
from tests.support.recordings import recorded_answer
from tests.support.transport import FakeTransport, Reply

API = "https://musicbrainz.org/ws/2"
COVERS = "https://coverartarchive.org"
ORIGINAL = "1834eae1-741b-3c03-9ca5-0df3decb43ea"
"""The earliest release of *OK Computer* the recorded search lists: Japan, 1997-05-21."""
REISSUE = "d339ba4d-0e44-4d2d-bc7a-b8078c072da9"
"""The 2016 reissue of *OK Computer*, which the recorded release lookup describes."""
LET_DOWN = "47b02a82-c3bf-4647-b894-dd1c8f608e7f"
"""The recording of *Let Down* the recorded search scores 100."""
OK_COMPUTER_GROUP = "b1392450-e666-3926-a536-22c65f834433"
"""The release group of every release of *OK Computer*."""
SHU_PU_GROUP = "7a1b2c3d-0000-4000-8000-00000000c3d4"
"""A made-up release group of 生如夏花, for the hand-made answers."""
SHU_PU = "0f463449-2b8b-4874-88ed-92392d97f955"
"""The 2003 original of 朴树's 生如夏花 in the hand-made answers."""
BEATLES = "b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d"
"""The Beatles on MusicBrainz."""


class FakeMusicBrainz(FakeTransport):
    """A transport answering for MusicBrainz and the Cover Art Archive."""


class MusicBrainzFactory:
    """Builds the answers of MusicBrainz and the sites it points to, from the recordings."""

    @staticmethod
    def beatles_search() -> dict[str, Any]:
        """Return the hand-made artist search for *披头士*.

        The Beatles score 100, and go by Beatles, 披头士 (zh), 披頭四 (zh_Hant), and
        ザ・ビートルズ (ja); a made-up tribute band, 披头士乐队纪念乐团, scores 61.
        """
        return recorded_answer("cjk-artist-search")

    @staticmethod
    def let_down_search(*, score: int | None = None) -> dict[str, Any]:
        """Return the recorded recording search for *Let Down* by *Radiohead*.

        Its best recording, scoring 100, is on 55 releases, among them the 1997
        originals and the 2016 reissue; its second, *Let Down (Thom 4track)*, scores 92
        and is 176 seconds long. With `score`, every recording scores that instead.
        """
        answer = recorded_answer("latin-search")
        if score is not None:
            for recording in answer["recordings"]:
                recording["score"] = score
        return answer

    @staticmethod
    def ok_computer(
        release: str = ORIGINAL, *, date: str = "1997-05-21", front: bool = True
    ) -> dict[str, Any]:
        """Return the recorded lookup of *OK Computer*, as the release `release` of `date`.

        The recording is the 1997 original's, with genres: the release's own is *rock*
        (counted once), and *Let Down*'s recording has *alternative rock* (6), *rock*
        (3), and *britpop*, *post-britpop*, and *punk* (1 each). Listeners rated *Let
        Down* 4.2 from 24 votes and the album, its release group, 4.55 from 89. Here its id and date
        are those of `release`, and `front` says whether it has a front cover.
        """
        answer = recorded_answer("latin-release")
        answer.update(id=release, date=date)
        answer["cover-art-archive"] = {"front": front, "back": False, "count": int(front)}
        return answer

    @staticmethod
    def shu_pu_search() -> dict[str, Any]:
        """Return the hand-made release search for 生如夏花 by 朴树."""
        return recorded_answer("cjk-release-search")

    @staticmethod
    def shu_pu_release(
        *,
        front: bool = True,
        genres: Mapping[str, int] | None = None,
        rated: tuple[float, int] | None = None,
    ) -> dict[str, Any]:
        """Return the hand-made lookup of 生如夏花, with 11 songs, and `genres` by count.

        With `rated`, its release group is rated that, from that many votes.
        """
        answer = recorded_answer("cjk-release")
        answer["cover-art-archive"] = {"front": front, "back": False, "count": int(front)}
        if genres is not None:
            answer["genres"] = [{"name": name, "count": count} for name, count in genres.items()]
        if rated is not None:
            value, votes = rated
            rating = {"value": value, "votes-count": votes}
            answer["release-group"] = {"id": SHU_PU_GROUP, "rating": rating}
        return answer


class FakeMusicBrainzFactory:
    """Builds a fake that knows the sites' answers for a song and for an album."""

    @staticmethod
    def knowing_let_down(*, front: bool = True, image: bytes | None = None) -> FakeMusicBrainz:
        """Return a fake that finds *Let Down* on its original release, with a cover.

        ```text
        /recording             the recorded search
        /release/1834eae1…     OK Computer, 1997-05-21
        /release/1834eae1…/front-500   a redirect to archive.org, which holds a JPEG
        ```
        """
        picture = jpeg_image("OK Computer") if image is None else image
        return (
            FakeMusicBrainz()
            .answer(f"{API}/recording", Reply.json(MusicBrainzFactory.let_down_search()))
            .answer(
                f"{API}/release/{ORIGINAL}", Reply.json(MusicBrainzFactory.ok_computer(front=front))
            )
            .answer(
                f"{COVERS}/release/{ORIGINAL}/front-500",
                Reply.redirect("https://archive.org/cover.jpg"),
            )
            .answer("https://archive.org/cover.jpg", Reply(200, {}, picture))
        )

    @staticmethod
    def knowing_shu_pu() -> FakeMusicBrainz:
        """Return a fake that finds the album 生如夏花 by 朴树 on its 2003 original."""
        return (
            FakeMusicBrainz()
            .answer(f"{API}/release", Reply.json(MusicBrainzFactory.shu_pu_search()))
            .answer(f"{API}/release/{SHU_PU}", Reply.json(MusicBrainzFactory.shu_pu_release()))
            .answer(
                f"{COVERS}/release/{SHU_PU}/front-500",
                Reply.redirect("https://archive.org/shu-pu.jpg"),
            )
            .answer("https://archive.org/shu-pu.jpg", Reply(200, {}, jpeg_image("生如夏花")))
        )
