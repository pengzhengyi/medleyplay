"""Deezer is asked for pictures of the artists going by a name, through its public API.

Every request goes to a fake transport: no test contacts deezer.com.
"""

from pathlib import Path

import pytest
import requests

from medleyplay.plugin_api import (
    MAX_COVER_BYTES,
    MAX_PICTURES,
    FindPictures,
    FindStatus,
    FoundPicture,
    NetworkError,
)
from medleyplay.plugins.deezer.pictures import SEARCH, SPACING, DeezerPictures
from medleyplay.plugins.lyrics.lrclib import USER_AGENT
from tests.support.transport import FakeTransport, FakeWaits, Reply

JPEG = b"\xff\xd8\xff\xe0" + b"jay" * 40
"""The start of a JPEG image, as a picture is."""


def picture_of(artist_id: int) -> str:
    """Where Deezer keeps the 1000-pixel picture of the artist `artist_id`."""
    return f"https://e-cdns-images.dzcdn.net/images/artist/{artist_id:032x}/1000x1000-000000-80-0-0.jpg"


def artist(artist_id: int, name: str, fans: int, **changes: object) -> dict[str, object]:
    """An artist as Deezer's search lists it."""
    return {
        "id": artist_id,
        "name": name,
        "picture_xl": picture_of(artist_id),
        "nb_fan": fans,
        "type": "artist",
        **changes,
    }


def searched(*artists: dict[str, object]) -> Reply:
    """Deezer's search answering `artists`."""
    return Reply.json({"data": list(artists), "total": len(artists)})


def image(data: bytes = JPEG) -> Reply:
    return Reply(200, {"Content-Type": "image/jpeg"}, data)


def asking_for(name: str, folder: Path) -> FindPictures:
    return FindPictures(artist=name, folder=str(folder))


def deezer_of(fake: FakeTransport, waits: FakeWaits | None = None) -> DeezerPictures:
    waits = waits or FakeWaits()
    return DeezerPictures(fake.session(), sleep=waits.sleep, clock=waits.clock)


def test_the_artists_going_by_a_name_are_found_with_their_pictures_most_followed_first(
    tmp_path: Path,
) -> None:
    fake = (
        FakeTransport()
        .answer(SEARCH, searched(artist(2, "周杰伦", 743), artist(1, "Jay Chou", 58_855)))
        .answer(picture_of(1), image())
        .answer(picture_of(2), image(JPEG + b"other"))
    )

    found = deezer_of(fake).find(asking_for("周杰伦", tmp_path))

    assert found.pictures == (
        FoundPicture(name="Jay Chou", fans=58_855, file="1.jpg"),
        FoundPicture(name="周杰伦", fans=743, file="2.jpg"),
    )
    assert fake.parameter("q") == "周杰伦"
    assert (tmp_path / "1.jpg").read_bytes() == JPEG


def test_only_plain_get_requests_are_sent_naming_medleyplay_and_paced(tmp_path: Path) -> None:
    waits = FakeWaits()
    fake = (
        FakeTransport()
        .answer(SEARCH, searched(artist(1, "Jay Chou", 1)))
        .answer(picture_of(1), image())
    )

    deezer_of(fake, waits).find(asking_for("Jay Chou", tmp_path))

    assert [each.method for each in fake.sent] == ["GET", "GET"]
    assert all(each.headers["User-Agent"] == USER_AGENT for each in fake.sent)
    assert all(timeout is not None for timeout in fake.timeouts)
    assert waits.pauses == [SPACING]


def test_an_artist_with_the_blank_picture_of_deezer_or_none_is_left_out(tmp_path: Path) -> None:
    blank = "https://e-cdns-images.dzcdn.net/images/artist//1000x1000-000000-80-0-0.jpg"
    fake = (
        FakeTransport()
        .answer(
            SEARCH,
            searched(
                artist(1, "Jay", 9, picture_xl=blank),
                artist(2, "Jay", 8, picture_xl=None),
                artist(3, "Jay", 7),
            ),
        )
        .answer(picture_of(3), image())
    )

    found = deezer_of(fake).find(asking_for("Jay", tmp_path))

    assert [each.file for each in found.pictures] == ["3.jpg"]
    assert fake.urls() == [SEARCH, picture_of(3)]


def test_a_picture_anywhere_but_the_image_site_of_deezer_over_https_is_never_fetched(
    tmp_path: Path,
) -> None:
    fake = FakeTransport().answer(
        SEARCH,
        searched(
            artist(1, "Jay", 9, picture_xl="https://example.com/jay.jpg"),
            artist(2, "Jay", 8, picture_xl=picture_of(2).replace("https", "http")),
        ),
    )

    found = deezer_of(fake).find(asking_for("Jay", tmp_path))

    assert found.pictures == ()
    assert fake.urls() == [SEARCH]


def test_a_picture_that_is_no_image_or_too_large_is_left_out(tmp_path: Path) -> None:
    fake = (
        FakeTransport()
        .answer(SEARCH, searched(artist(1, "Jay", 9), artist(2, "Jay", 8), artist(3, "Jay", 7)))
        .answer(picture_of(1), image(b"<html>not an image</html>"))
        .answer(picture_of(2), image(b"\xff\xd8\xff" + b"0" * MAX_COVER_BYTES))
        .answer(picture_of(3), Reply(404))
    )

    found = deezer_of(fake).find(asking_for("Jay", tmp_path))

    assert found.pictures == ()


def test_at_most_eight_pictures_are_answered(tmp_path: Path) -> None:
    many = [artist(each, f"Jay {each}", 100 - each) for each in range(1, 12)]
    fake = FakeTransport().answer(SEARCH, searched(*many))
    for each in range(1, 12):
        fake.answer(picture_of(each), image(JPEG + bytes([each])))

    found = deezer_of(fake).find(asking_for("Jay", tmp_path))

    assert len(found.pictures) == MAX_PICTURES
    assert found.pictures[0].name == "Jay 1"


def test_a_refusal_is_answered_as_one(tmp_path: Path) -> None:
    fake = FakeTransport().answer(SEARCH, Reply.json({}, status=403))

    found = deezer_of(fake).find(asking_for("Jay", tmp_path))

    assert found.status is FindStatus.REFUSED
    assert "Deezer" in found.message


@pytest.mark.parametrize(
    "reply",
    [
        Reply.json({}, status=429),
        Reply.json({"error": {"type": "Exception", "message": "Quota limit exceeded", "code": 4}}),
        Reply.json({}, status=503),
    ],
    ids=["HTTP 429", "quota", "HTTP 503"],
)
def test_a_busy_site_fails_the_finding_without_asking_again(reply: Reply, tmp_path: Path) -> None:
    fake = FakeTransport().answer(SEARCH, reply)

    with pytest.raises(NetworkError, match="Deezer"):
        deezer_of(fake).find(asking_for("Jay", tmp_path))

    assert fake.urls() == [SEARCH]


def test_an_unreachable_site_is_a_network_failure(tmp_path: Path) -> None:
    fake = FakeTransport().answer(SEARCH, requests.ConnectionError("no route"))

    with pytest.raises(NetworkError, match="Deezer couldn't be reached"):
        deezer_of(fake).find(asking_for("Jay", tmp_path))


@pytest.mark.parametrize(
    "reply",
    [
        Reply.json({"data": "none"}),
        Reply.json({"error": {"type": "DataException", "message": "no data", "code": 800}}),
        Reply(200, {"Content-Type": "text/html"}, b"<html></html>"),
    ],
    ids=["data of another shape", "another error", "no JSON"],
)
def test_an_answer_it_cant_use_is_an_error(reply: Reply, tmp_path: Path) -> None:
    fake = FakeTransport().answer(SEARCH, reply)

    with pytest.raises(ValueError, match="Deezer"):
        deezer_of(fake).find(asking_for("Jay", tmp_path))
