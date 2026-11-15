"""The artist name finder's answer: the pages it gives are on the web, over HTTPS."""

import pytest
from pydantic import ValidationError

from medleyplay.plugin_api import FoundArtistNames


@pytest.mark.parametrize(
    "page",
    [
        "javascript:alert(1)",
        "http://www.wikidata.org/wiki/Q1299",
        "data:text/html,hello",
        "https://www.wikidata.org/" + "a" * 2048,
    ],
    ids=["script", "not over HTTPS", "data", "too long"],
)
def test_a_page_or_photo_page_that_is_not_a_web_page_over_https_is_refused(page: str) -> None:
    with pytest.raises(ValidationError):
        FoundArtistNames(page=page)
    with pytest.raises(ValidationError):
        FoundArtistNames(photo_page=page)


def test_a_page_over_https_is_taken() -> None:
    found = FoundArtistNames(page="https://www.wikidata.org/wiki/Q1299")

    assert found.page == "https://www.wikidata.org/wiki/Q1299"
