"""A Wikidata that answers from a table, with no socket opened."""

from typing import Any, Final

from tests.support.musicbrainz import BEATLES
from tests.support.recordings import recorded_answer
from tests.support.transport import FakeTransport, Reply

API: Final = "https://www.wikidata.org/w/api.php"
BEATLES_ITEM: Final = "Q1299"
"""The Beatles on Wikidata, whose MusicBrainz artist id is `BEATLES`."""

__all__ = ["API", "BEATLES", "BEATLES_ITEM", "FakeWikidata", "WikidataFactory"]


class FakeWikidata(FakeTransport):
    """A transport answering for Wikidata."""


class WikidataFactory:
    """Builds Wikidata's answers from the recordings."""

    @staticmethod
    def beatles_search() -> dict[str, Any]:
        """Return the recorded search for the item whose MusicBrainz artist id is The Beatles'.

        It finds one item, `Q1299`.
        """
        return recorded_answer("wikidata-search")

    @staticmethod
    def no_item() -> dict[str, Any]:
        """Return a search that finds no item."""
        return {"batchcomplete": "", "query": {"searchinfo": {"totalhits": 0}, "search": []}}

    @staticmethod
    def beatles() -> dict[str, Any]:
        """Return the recorded labels and aliases of The Beatles in Chinese, Japanese,
        Korean, and English.

        ```text
        zh       披頭四樂隊; also 披頭士, 披头士, 披頭四, 披头四, 甲壳虫乐队, 甲壳虫, 披頭士樂隊
        zh-hans  披头士乐队; also 披头士
        ja       ビートルズ; also ザ・ビートルズ
        en       The Beatles; also The Lads from Liverpool, The Beetles, …
        ```
        """
        return recorded_answer("wikidata-entity")

    @staticmethod
    def missing(item: str) -> dict[str, Any]:
        """Return the answer for an item Wikidata doesn't have."""
        return {"entities": {item: {"id": item, "missing": ""}}, "success": 1}


class FakeWikidataFactory:
    """Builds a fake that knows an artist."""

    @staticmethod
    def knowing_beatles() -> FakeWikidata:
        """Return a fake whose search finds The Beatles' item, and which knows its names.

        Both requests go to the one API address, so it answers the search, then the item.
        """
        return FakeWikidata().answer(
            API,
            Reply.json(WikidataFactory.beatles_search()),
            Reply.json(WikidataFactory.beatles()),
        )
