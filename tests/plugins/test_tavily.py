"""Tavily discovery uses only source-linked images, never a download or an inferred source."""

import pytest
import requests
from pydantic import SecretStr

from medleyplay.plugin_api import NetworkError
from medleyplay.plugin_api.image_search import SearchPictures
from medleyplay.plugins.tavily import TavilyPictures
from tests.support.transport import FakeTransport, Reply

ENDPOINT = "https://api.tavily.com/search"
PAGE = "https://record.example/album"
IMAGE = "https://images.example/cover.jpg"
KEY = "test-provider-key"


def _search() -> SearchPictures:
    return SearchPictures(album="Help!", artist="The Beatles", key=SecretStr(KEY))


def test_images_keep_their_own_source_and_unattributed_images_are_not_offered() -> None:
    transport = FakeTransport().answer(
        ENDPOINT,
        Reply.json(
            {
                "images": ["https://elsewhere.example/front.jpg"],
                "results": [
                    {"url": "https://unrelated.example/page", "title": "Unrelated"},
                    {"url": PAGE, "title": "First pressing", "images": [IMAGE, {"url": IMAGE}]},
                    {"url": "http://record.example/album", "images": [IMAGE]},
                    {"url": PAGE, "images": ["https://private.example/cover.jpg"]},
                ],
            }
        ),
    )
    plugin = TavilyPictures(
        transport.session(),
        resolve=lambda host: ["192.168.1.1"] if host == "private.example" else ["1.1.1.1"],
    )

    answer = plugin.search(_search())

    assert [image.model_dump() for image in answer.images] == [
        {"url": IMAGE, "page": PAGE, "title": "First pressing"}
    ]
    assert transport.urls() == [ENDPOINT]
    assert transport.sent[0].headers["Authorization"] == f"Bearer {KEY}"
    assert transport.body()["include_images"] is True
    assert "Help!" in transport.body()["query"]
    assert "The Beatles" in transport.body()["query"]


@pytest.mark.parametrize("reply", [Reply.redirect(PAGE), Reply.json({"error": KEY}, 401)])
def test_a_refusal_does_not_repeat_the_body_or_forward_the_key(reply: Reply) -> None:
    transport = FakeTransport().answer(ENDPOINT, reply)
    plugin = TavilyPictures(transport.session(), resolve=lambda _: [])

    answer = plugin.search(_search())

    assert answer.status == "refused"
    assert KEY not in answer.model_dump_json()
    assert transport.urls() == [ENDPOINT]


def test_transport_errors_do_not_repeat_the_request_or_key() -> None:
    transport = FakeTransport().answer(ENDPOINT, requests.ConnectionError(KEY))
    plugin = TavilyPictures(transport.session(), resolve=lambda _: [])

    with pytest.raises(NetworkError) as failure:
        plugin.search(_search())

    assert KEY not in str(failure.value)


def test_a_provider_echo_never_becomes_a_returned_title_page_or_image() -> None:
    transport = FakeTransport().answer(
        ENDPOINT,
        Reply.json(
            {
                "results": [
                    {"url": PAGE, "title": KEY, "images": [IMAGE]},
                    {"url": f"{PAGE}?q={KEY}", "images": [IMAGE]},
                    {"url": PAGE, "images": [f"{IMAGE}?q={KEY}"]},
                ],
            },
        ),
    )
    plugin = TavilyPictures(transport.session(), resolve=lambda _: ["1.1.1.1"])

    assert plugin.search(_search()).images == ()
