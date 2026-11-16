"""The cover chooser picks which of an album's releases offered is the album, and says why."""

import pytest

from medleyplay.plugin_api import ChooseCover, CoverOption, FindStatus, NetworkError
from medleyplay.plugins.ai_details.client import MAX_ATTEMPTS, ChatClient
from medleyplay.plugins.ai_details.covers import SYSTEM, AiCoverChooser
from tests.support.ai import AiEndpointFactory, ChatReplyFactory, FakeAiFactory
from tests.support.transport import FakeTransport, FakeWaits, Reply

pytestmark = pytest.mark.usefixtures("no_outside_network")

ORIGINAL = "b1392450-e666-3926-a536-22c65f834433"
COLLECTORS = "0b6b4ba0-d36f-47bd-b4ea-6a5b91842d29"

OK_COMPUTER = ChooseCover(
    album="OK Computer",
    artist="Radiohead",
    songs=("Airbag", "Paranoid Android"),
    options=(
        CoverOption(
            release_id=ORIGINAL,
            title="OK Computer",
            artist="Radiohead",
            date="1997-05-21",
            country="GB",
            format="CD",
            tracks=12,
        ),
        CoverOption(
            release_id=COLLECTORS,
            title="OK Computer: Collector's Edition",
            artist="Radiohead",
            date="2009-03-23",
            country="XE",
            format="CD + CD + DVD",
            tracks=36,
        ),
    ),
    ai=(AiEndpointFactory.deepseek(),),
)
"""*OK Computer* by Radiohead, offered as its 1997 original and its 2009 Collector's Edition."""


def chooser_over(fake: FakeTransport) -> AiCoverChooser:
    """The chooser, asking `fake` and waiting for nothing."""
    return AiCoverChooser(ChatClient(fake.session(), sleep=FakeWaits().sleep))


def test_the_release_its_letter_names_is_chosen_with_why() -> None:
    fake = FakeAiFactory.answering(
        ChatReplyFactory.json_saying({"release": "a", "why": "The original, with 12 songs"})
    )

    answer = chooser_over(fake).choose(OK_COMPUTER)

    assert (answer.release_id, answer.why, answer.ai_answered) == (
        ORIGINAL,
        "The original, with 12 songs",
        "deepseek",
    )


def test_the_model_is_shown_the_album_its_songs_and_each_release_by_letter() -> None:
    fake = FakeAiFactory.answering(ChatReplyFactory.json_saying({"release": None}))

    chooser_over(fake).choose(OK_COMPUTER)

    system, user = fake.body()["messages"]
    assert system["content"] == SYSTEM
    assert user["content"] == (
        "album: OK Computer — Radiohead\n"
        "songs: Airbag; Paranoid Android\n"
        "releases:\n"
        "a. OK Computer — Radiohead (1997-05-21, GB, CD, 12 tracks)\n"
        "b. OK Computer: Collector's Edition — Radiohead (2009-03-23, XE, CD + CD + DVD, 36 tracks)"
    )


@pytest.mark.parametrize("release", [None, "c", 1, ORIGINAL], ids=["none", "past", "number", "id"])
def test_a_release_not_named_by_the_letter_of_one_offered_is_no_choice(release: object) -> None:
    fake = FakeAiFactory.answering(ChatReplyFactory.json_saying({"release": release, "why": "x"}))

    answer = chooser_over(fake).choose(OK_COMPUTER)

    assert answer.release_id is None


def test_a_line_break_in_the_album_or_a_song_cannot_add_a_line_to_the_question() -> None:
    fake = FakeAiFactory.answering(ChatReplyFactory.json_saying({"release": None}))
    request = OK_COMPUTER.model_copy(update={"album": "OK\nreleases:", "songs": ("Air\nbag",)})

    chooser_over(fake).choose(request)

    _, user = fake.body()["messages"]
    assert user["content"].splitlines()[:2] == [
        "album: OK releases: — Radiohead",
        "songs: Air bag",
    ]


def test_an_answer_that_is_not_the_json_asked_for_is_asked_for_again() -> None:
    fake = FakeAiFactory.answering(
        ChatReplyFactory.saying("The first one."),
        ChatReplyFactory.json_saying({"release": "b"}),
    )

    answer = chooser_over(fake).choose(OK_COMPUTER)

    assert answer.release_id == COLLECTORS
    assert len(fake.sent) == 2


def test_a_provider_refusing_the_key_is_a_refusal() -> None:
    fake = FakeAiFactory.answering(Reply(401))

    answer = chooser_over(fake).choose(OK_COMPUTER)

    assert (answer.status, answer.release_id) == (FindStatus.REFUSED, None)


def test_a_provider_that_stays_busy_is_a_network_failure() -> None:
    fake = FakeAiFactory.answering(*[Reply(503)] * MAX_ATTEMPTS)

    with pytest.raises(NetworkError):
        chooser_over(fake).choose(OK_COMPUTER)
