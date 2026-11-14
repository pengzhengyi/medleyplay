"""The name finder: every name Wikidata knows an artist by, found by its MusicBrainz id."""

import pytest

from medleyplay.plugin_api import ArtistAlias, FindArtistNames, FindStatus, NetworkError
from medleyplay.plugins.wikipedia.client import USER_AGENT, WikidataClient
from medleyplay.plugins.wikipedia.names import WikidataNames
from tests.support.transport import FakeWaits, Reply
from tests.support.wikidata import (
    API,
    BEATLES,
    BEATLES_ITEM,
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
