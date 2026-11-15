"""A Wikidata that answers from a table, with no socket opened."""

from typing import Any, Final

from tests.support.musicbrainz import BEATLES
from tests.support.recordings import recorded_answer
from tests.support.transport import FakeTransport, Reply

API: Final = "https://www.wikidata.org/w/api.php"
PHOTO_FILE: Final = "The Beatles in 1964.jpg"
"""The file of a photo on Wikimedia Commons, as an item's image names it."""
PHOTO: Final = "https://commons.wikimedia.org/wiki/Special:FilePath/The_Beatles_in_1964.jpg"
"""Where Commons is asked for the photo, which it answers with a redirect to the image."""
PHOTO_IMAGE: Final = "https://upload.wikimedia.org/thumb/the-beatles-in-1964-500px.jpg"
BEATLES_ITEM: Final = "Q1299"
"""The Beatles on Wikidata, whose MusicBrainz artist id is `BEATLES`."""

__all__ = [
    "API",
    "BEATLES",
    "BEATLES_ITEM",
    "PHOTO",
    "PHOTO_FILE",
    "PHOTO_IMAGE",
    "FakeWikidata",
    "WikidataFactory",
]


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
    def images(*statements: tuple[str, str]) -> dict[str, Any]:
        """Return an item's images, each a file and its rank, in Wikidata's shape.

        It is hand-made: `images(("Live.jpg", "deprecated"), (PHOTO_FILE, "normal"))`
        answers as Wikidata answers `wbgetclaims` for the property P18.
        """
        return {
            "claims": {
                "P18": [
                    {
                        "mainsnak": {
                            "snaktype": "value",
                            "property": "P18",
                            "datavalue": {"value": file, "type": "string"},
                            "datatype": "commonsMedia",
                        },
                        "type": "statement",
                        "rank": rank,
                    }
                    for file, rank in statements
                ]
            }
        }

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

    @staticmethod
    def knowing_beatles_photo(photo: bytes) -> FakeWikidata:
        """Return a fake that knows The Beatles' names, and their image `PHOTO_FILE`.

        Commons answers for the photo with a redirect to its image, `photo`.
        """
        return (
            FakeWikidata()
            .answer(
                API,
                Reply.json(WikidataFactory.beatles_search()),
                Reply.json(WikidataFactory.beatles()),
                Reply.json(WikidataFactory.images((PHOTO_FILE, "normal"))),
            )
            .answer(PHOTO, Reply.redirect(PHOTO_IMAGE))
            .answer(PHOTO_IMAGE, Reply(200, {"Content-Type": "image/jpeg"}, photo))
        )
