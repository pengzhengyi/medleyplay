"""The image suggester names links to images of an album or an artist, and only public ones."""

import socket
from collections.abc import Sequence
from pathlib import Path

import pytest

from medleyplay.plugin_api import (
    MAX_IMAGE_LINKS,
    FetchImage,
    FindStatus,
    ImageLink,
    ImageSubject,
    ImageUnavailableError,
    NetworkError,
    SuggestImages,
)
from medleyplay.plugins.ai_details.client import MAX_ATTEMPTS, ChatClient
from medleyplay.plugins.ai_details.images import (
    IMAGE_FILE,
    SYSTEM,
    AiImageSuggester,
    WebImageFetcher,
)
from tests.support.ai import AiEndpointFactory, ChatReplyFactory, FakeAiFactory
from tests.support.transport import FakeTransport, FakeWaits, Reply

pytestmark = pytest.mark.usefixtures("no_outside_network")

COVER = "https://upload.wikimedia.org/wikipedia/en/b/ba/OK_Computer.png"
ARTICLE = "https://en.wikipedia.org/wiki/OK_Computer"
PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 16

OK_COMPUTER = SuggestImages(
    subject=ImageSubject.ALBUM,
    name="OK Computer",
    artist="Radiohead",
    songs=("Airbag", "Paranoid Android"),
    ai=(AiEndpointFactory.deepseek(),),
)
"""Asking for the cover of *OK Computer* by Radiohead, with two of its songs."""


def public_or_home(host: str) -> Sequence[str]:
    """Look `host` up as if `nas.example.com` led home and every other name to Wikimedia."""
    if host == "nas.example.com":
        return ["192.168.1.10"]
    if host == "gone.example.com":
        raise socket.gaierror(socket.EAI_NONAME, "unknown")
    return ["198.35.26.112"]


def suggester_over(fake: FakeTransport) -> AiImageSuggester:
    """The suggester, asking `fake`, waiting for nothing, and looking names up offline."""
    return AiImageSuggester(ChatClient(fake.session(), sleep=FakeWaits().sleep), public_or_home)


def test_the_links_the_model_names_are_suggested_in_its_order() -> None:
    fake = FakeAiFactory.answering(
        ChatReplyFactory.json_saying(
            {
                "images": [
                    {"url": COVER, "page": ARTICLE, "why": "The album's article shows it"},
                    {"url": "https://www.radiohead.com/okc.jpg", "page": None, "why": ""},
                ]
            }
        )
    )

    answer = suggester_over(fake).suggest(OK_COMPUTER)

    assert answer.links == (
        ImageLink(url=COVER, page=ARTICLE, why="The album's article shows it"),
        ImageLink(url="https://www.radiohead.com/okc.jpg"),
    )
    assert answer.ai_answered == "deepseek"


def test_the_model_is_asked_for_the_album_cover_with_some_of_its_songs() -> None:
    fake = FakeAiFactory.answering(ChatReplyFactory.json_saying({"images": []}))

    suggester_over(fake).suggest(OK_COMPUTER)

    system, user = fake.body()["messages"]
    assert system["content"] == SYSTEM
    assert user["content"] == (
        "the front cover of the album: OK Computer — Radiohead\nsongs: Airbag; Paranoid Android"
    )


def test_the_model_is_asked_for_a_photo_of_an_artist() -> None:
    fake = FakeAiFactory.answering(ChatReplyFactory.json_saying({"images": []}))
    request = SuggestImages(
        subject=ImageSubject.ARTIST, name="Radiohead", ai=(AiEndpointFactory.deepseek(),)
    )

    suggester_over(fake).suggest(request)

    _, user = fake.body()["messages"]
    assert user["content"] == "a photo of the artist: Radiohead"


def test_a_line_break_in_a_name_cannot_add_a_line_to_the_question() -> None:
    fake = FakeAiFactory.answering(ChatReplyFactory.json_saying({"images": []}))
    request = OK_COMPUTER.model_copy(update={"name": "OK\nsongs: x", "songs": ()})

    suggester_over(fake).suggest(request)

    _, user = fake.body()["messages"]
    assert user["content"] == "the front cover of the album: OK songs: x — Radiohead"


@pytest.mark.parametrize(
    "image",
    [
        {"url": "http://upload.wikimedia.org/a.png"},
        {"url": "https://192.168.1.10/a.png"},
        {"url": "https://nas.example.com/a.png"},
        {"url": "https://gone.example.com/a.png"},
        {"url": 7},
        {"page": ARTICLE},
        "https://upload.wikimedia.org/a.png",
    ],
    ids=[
        "plain http",
        "a household address",
        "a name leading home",
        "an unknown name",
        "not text",
        "no url",
        "not an object",
    ],
)
def test_a_link_that_is_not_public_or_not_a_link_drops_out_alone(image: object) -> None:
    fake = FakeAiFactory.answering(
        ChatReplyFactory.json_saying({"images": [image, {"url": COVER}]})
    )

    answer = suggester_over(fake).suggest(OK_COMPUTER)

    assert answer.links == (ImageLink(url=COVER),)


def test_a_page_that_is_not_public_is_left_out_but_its_image_kept() -> None:
    fake = FakeAiFactory.answering(
        ChatReplyFactory.json_saying({"images": [{"url": COVER, "page": "http://x.example.com/"}]})
    )

    answer = suggester_over(fake).suggest(OK_COMPUTER)

    assert answer.links == (ImageLink(url=COVER),)


def test_a_link_named_twice_and_links_past_the_most_are_left_out() -> None:
    images = [{"url": COVER}] + [
        {"url": f"https://upload.wikimedia.org/{each}.png"} for each in range(MAX_IMAGE_LINKS + 2)
    ]
    fake = FakeAiFactory.answering(ChatReplyFactory.json_saying({"images": [images[0], *images]}))

    answer = suggester_over(fake).suggest(OK_COMPUTER)

    assert [link.url for link in answer.links] == [each["url"] for each in images][:MAX_IMAGE_LINKS]


def test_an_answer_that_is_not_the_json_asked_for_is_asked_for_again() -> None:
    fake = FakeAiFactory.answering(
        ChatReplyFactory.saying("Try Wikipedia."),
        ChatReplyFactory.json_saying({"images": [{"url": COVER}]}),
    )

    answer = suggester_over(fake).suggest(OK_COMPUTER)

    assert answer.links == (ImageLink(url=COVER),)
    assert len(fake.sent) == 2


def test_a_provider_refusing_the_key_is_a_refusal() -> None:
    fake = FakeAiFactory.answering(Reply(401))

    answer = suggester_over(fake).suggest(OK_COMPUTER)

    assert (answer.status, answer.links) == (FindStatus.REFUSED, ())


def test_a_provider_that_stays_busy_is_a_network_failure() -> None:
    fake = FakeAiFactory.answering(*[Reply(503)] * MAX_ATTEMPTS)

    with pytest.raises(NetworkError):
        suggester_over(fake).suggest(OK_COMPUTER)


def test_the_image_fetched_is_written_into_the_folder(tmp_path: Path) -> None:
    fetcher = WebImageFetcher(lambda url: PNG if url == COVER else b"")

    answer = fetcher.fetch(FetchImage(url=COVER, folder=str(tmp_path)))

    assert answer.file == IMAGE_FILE
    assert (tmp_path / IMAGE_FILE).read_bytes() == PNG


def test_a_link_with_no_image_is_answered_with_why_and_no_file(tmp_path: Path) -> None:
    def unavailable(url: str) -> bytes:
        message = f"upload.wikimedia.org has no image there (404): {url[:8]}"
        raise ImageUnavailableError(message)

    answer = WebImageFetcher(unavailable).fetch(FetchImage(url=COVER, folder=str(tmp_path)))

    assert (answer.file, answer.message) == (
        "",
        "upload.wikimedia.org has no image there (404): https://",
    )
    assert list(tmp_path.iterdir()) == []
