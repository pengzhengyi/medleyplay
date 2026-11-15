"""The name finder: every name Wikidata knows an artist by, found by its MusicBrainz id.

It also gives the artist's page on Wikidata, and the item's image from Wikimedia
Commons as the artist's photo.
"""

from pathlib import Path

import pytest
import requests

from medleyplay.plugin_api import ArtistAlias, FindArtistNames, FindStatus, NetworkError
from medleyplay.plugins.wikipedia.client import USER_AGENT, WikidataClient
from medleyplay.plugins.wikipedia.names import WikidataNames
from tests.support.images import gif_image, jpeg_image, oversized_jpeg
from tests.support.transport import FakeWaits, Reply
from tests.support.wikidata import (
    API,
    BEATLES,
    BEATLES_ITEM,
    PHOTO,
    PHOTO_FILE,
    PHOTO_IMAGE,
    FakeWikidata,
    FakeWikidataFactory,
    WikidataFactory,
)

ASK = FindArtistNames(musicbrainz_id=BEATLES)


def finder_over(fake: FakeWikidata, waits: FakeWaits | None = None) -> WikidataNames:
    """The finder, asking `fake` and waiting as `waits` says."""
    waits = waits or FakeWaits()
    return WikidataNames(WikidataClient(fake.session(), sleep=waits.sleep, clock=waits.clock))


def test_the_names_an_artist_goes_by_come_from_the_item_holding_its_musicbrainz_id() -> None:
    fake = FakeWikidataFactory.knowing_beatles()

    found = finder_over(fake).find(ASK)

    assert fake.parameter("srsearch") == f"haswbstatement:P434={BEATLES}"
    assert (fake.parameter("action", 1), fake.parameter("ids", 1)) == ("wbgetentities", "Q1299")
    assert found.status is FindStatus.OK
    assert ArtistAlias(name="甲壳虫乐队", locale="zh") in found.aliases
    assert ArtistAlias(name="ビートルズ", locale="ja", primary=True) in found.aliases


def test_a_name_comes_once_with_the_first_language_that_has_it() -> None:
    fake = FakeWikidataFactory.knowing_beatles()

    found = finder_over(fake).find(ASK)

    names = [alias.name for alias in found.aliases]
    assert len(names) == len(set(names))
    assert ArtistAlias(name="披头士", locale="zh") in found.aliases


def test_languages_are_written_as_musicbrainz_writes_locales() -> None:
    fake = FakeWikidataFactory.knowing_beatles()

    found = finder_over(fake).find(ASK)

    assert {alias.locale for alias in found.aliases} >= {"zh", "zh_Hans", "zh_TW", "zh_HK", "en"}


@pytest.mark.parametrize(
    "title",
    ["披头士 (乐队)", "披头士\uff08乐队\uff09"],
    ids=["ASCII brackets", "full-width brackets"],
)
def test_a_page_title_with_a_note_in_brackets_is_no_name(title: str) -> None:
    entity = WikidataFactory.beatles()
    entity["entities"][BEATLES_ITEM]["aliases"]["zh"].append({"language": "zh", "value": title})
    fake = FakeWikidata().answer(
        API, Reply.json(WikidataFactory.beatles_search()), Reply.json(entity)
    )

    found = finder_over(fake).find(ASK)

    assert title not in {alias.name for alias in found.aliases}


def test_an_artist_with_no_item_has_no_names() -> None:
    fake = FakeWikidata().answer(API, Reply.json(WikidataFactory.no_item()))

    found = finder_over(fake).find(ASK)

    assert (found.status, found.aliases) == (FindStatus.OK, ())
    assert len(fake.sent) == 1


def test_an_item_wikidata_no_longer_has_has_no_names() -> None:
    fake = FakeWikidata().answer(
        API,
        Reply.json(WikidataFactory.beatles_search()),
        Reply.json(WikidataFactory.missing(BEATLES_ITEM)),
    )

    found = finder_over(fake).find(ASK)

    assert (found.status, found.aliases) == (FindStatus.OK, ())


@pytest.mark.parametrize("status", [403, 429])
def test_wikidata_turning_requests_away_is_a_refusal(status: int) -> None:
    fake = FakeWikidata().answer(API, Reply(status))

    found = finder_over(fake).find(ASK)

    assert found.status is FindStatus.REFUSED


@pytest.mark.parametrize(
    "reply",
    [
        Reply(502),
        Reply(200, {"Content-Type": "text/html"}, b"<html>Sign in</html>"),
        Reply.json({"error": {"code": "maxlag", "info": "Waiting for a database"}}),
    ],
    ids=["server error", "not JSON", "an error answer"],
)
def test_an_answer_that_is_not_wikidata_s_is_a_network_failure(reply: Reply) -> None:
    fake = FakeWikidata().answer(API, reply)

    with pytest.raises(NetworkError):
        finder_over(fake).find(ASK)


def test_requests_name_medleyplay_and_come_a_second_apart() -> None:
    fake = FakeWikidataFactory.knowing_beatles()
    waits = FakeWaits()

    finder_over(fake, waits).find(ASK)

    assert {each.headers["User-Agent"] for each in fake.sent} == {USER_AGENT}
    assert "github.com/pengzhengyi/medleyplay" in USER_AGENT
    assert waits.pauses == [1.0]


def test_the_artist_s_page_is_its_wikidata_item() -> None:
    fake = FakeWikidataFactory.knowing_beatles()

    found = finder_over(fake).find(ASK)

    assert found.page == "https://www.wikidata.org/wiki/Q1299"


def test_without_a_folder_no_photo_is_asked_for() -> None:
    fake = FakeWikidataFactory.knowing_beatles()

    found = finder_over(fake).find(ASK)

    assert (found.photo, found.photo_page) == (None, None)
    assert len(fake.sent) == 2


def test_the_photo_is_the_item_s_image_from_commons_500_pixels_wide(tmp_path: Path) -> None:
    photo = jpeg_image("The Beatles in 1964")
    fake = FakeWikidataFactory.knowing_beatles_photo(photo)

    found = finder_over(fake).find(ASK.model_copy(update={"folder": str(tmp_path)}))

    assert (fake.parameter("action", 2), fake.parameter("property", 2)) == ("wbgetclaims", "P18")
    assert fake.urls()[3:] == [PHOTO, PHOTO_IMAGE]
    assert fake.parameter("width", 3) == "500"
    assert found.photo is not None
    assert (tmp_path / found.photo).read_bytes() == photo
    assert found.photo_page == "https://commons.wikimedia.org/wiki/File:The_Beatles_in_1964.jpg"


def test_the_preferred_image_is_the_photo_and_a_deprecated_one_never_is(tmp_path: Path) -> None:
    images = WikidataFactory.images(
        ("Ringo.jpg", "deprecated"), ("Live.jpg", "normal"), (PHOTO_FILE, "preferred")
    )
    fake = FakeWikidataFactory.knowing_beatles_photo(jpeg_image()).answer(
        API,
        Reply.json(WikidataFactory.beatles_search()),
        Reply.json(WikidataFactory.beatles()),
        Reply.json(images),
    )

    found = finder_over(fake).find(ASK.model_copy(update={"folder": str(tmp_path)}))

    assert fake.urls()[3] == PHOTO
    assert found.photo is not None


def test_an_item_with_only_a_deprecated_image_or_none_has_no_photo(tmp_path: Path) -> None:
    fake = FakeWikidata().answer(
        API,
        Reply.json(WikidataFactory.beatles_search()),
        Reply.json(WikidataFactory.beatles()),
        Reply.json(WikidataFactory.images(("Ringo.jpg", "deprecated"))),
    )

    found = finder_over(fake).find(ASK.model_copy(update={"folder": str(tmp_path)}))

    assert (found.photo, found.photo_page) == (None, None)
    assert ArtistAlias(name="甲壳虫乐队", locale="zh") in found.aliases
    assert len(fake.sent) == 3


@pytest.mark.parametrize(
    "reply",
    [
        Reply(404),
        Reply(200, {"Content-Type": "image/gif"}, gif_image()),
        Reply(200, {"Content-Type": "image/jpeg"}, oversized_jpeg()),
        requests.ConnectionError("down"),
    ],
    ids=["not found", "no cover image", "too large", "unreachable"],
)
def test_a_photo_commons_does_not_give_as_an_image_is_none_and_the_names_stay(
    tmp_path: Path, reply: Reply | Exception
) -> None:
    fake = FakeWikidataFactory.knowing_beatles_photo(jpeg_image()).answer(PHOTO_IMAGE, reply)

    found = finder_over(fake).find(ASK.model_copy(update={"folder": str(tmp_path)}))

    assert (found.status, found.photo, found.photo_page) == (FindStatus.OK, None, None)
    assert ArtistAlias(name="甲壳虫乐队", locale="zh") in found.aliases
    assert list(tmp_path.iterdir()) == []


def test_asking_for_the_photo_keeps_a_second_between_requests(tmp_path: Path) -> None:
    fake = FakeWikidataFactory.knowing_beatles_photo(jpeg_image())
    waits = FakeWaits()

    finder_over(fake, waits).find(ASK.model_copy(update={"folder": str(tmp_path)}))

    assert waits.pauses == [1.0, 1.0, 1.0]
    assert {each.headers["User-Agent"] for each in fake.sent} == {USER_AGENT}
