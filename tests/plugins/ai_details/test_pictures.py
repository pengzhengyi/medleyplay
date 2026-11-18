"""The picture chooser picks which picture a site has is of the household's artist, and why."""

import pytest

from medleyplay.plugin_api import ChoosePicture, FindStatus, NetworkError, PictureOption
from medleyplay.plugins.ai_details.client import MAX_ATTEMPTS, ChatClient
from medleyplay.plugins.ai_details.pictures import SYSTEM, AiPictureChooser
from tests.support.ai import AiEndpointFactory, ChatReplyFactory, FakeAiFactory
from tests.support.transport import FakeTransport, FakeWaits, Reply

pytestmark = pytest.mark.usefixtures("no_outside_network")

THE_BEATLES = ChoosePicture(
    artist="The Beatles",
    about="Liverpool rock band, GB",
    other_names=("披头士", "Beatles"),
    songs=("Yesterday", "Help!"),
    options=(
        PictureOption(name="The Beatles", fans=4_100_000),
        PictureOption(name="The Beatles", fans=120),
    ),
    ai=(AiEndpointFactory.deepseek(),),
)
"""The Beatles, offered as the two artists Deezer knows by the name, the most followed first."""


def chooser_over(fake: FakeTransport) -> AiPictureChooser:
    """The chooser, asking `fake` and waiting for nothing."""
    return AiPictureChooser(ChatClient(fake.session(), sleep=FakeWaits().sleep))


def test_the_picture_its_letter_names_is_chosen_with_why() -> None:
    fake = FakeAiFactory.answering(
        ChatReplyFactory.json_saying({"picture": "b", "why": "The tribute act"})
    )

    answer = chooser_over(fake).choose(THE_BEATLES)

    assert (answer.option, answer.why, answer.ai_answered) == (1, "The tribute act", "deepseek")


def test_the_model_is_shown_the_artist_its_names_songs_and_each_picture_by_letter() -> None:
    fake = FakeAiFactory.answering(ChatReplyFactory.json_saying({"picture": None}))

    chooser_over(fake).choose(THE_BEATLES)

    system, user = fake.body()["messages"]
    assert system["content"] == SYSTEM
    assert user["content"] == (
        "artist: The Beatles (Liverpool rock band, GB)\n"
        "also known as: 披头士; Beatles\n"
        "songs: Yesterday; Help!\n"
        "pictures:\n"
        "a. The Beatles (4,100,000 fans)\n"
        "b. The Beatles (120 fans)"
    )


def test_the_listener_s_note_follows_as_a_message_of_its_own() -> None:
    fake = FakeAiFactory.answering(ChatReplyFactory.json_saying({"picture": "a"}))

    chooser_over(fake).choose(THE_BEATLES.model_copy(update={"hint": "the band,\nnot a tribute"}))

    _, _, note = fake.body()["messages"]
    assert note == {"role": "user", "content": "Note from the listener: the band, not a tribute"}


@pytest.mark.parametrize(
    "picture", [None, "c", 0, "The Beatles"], ids=["none", "past", "number", "name"]
)
def test_a_picture_not_named_by_the_letter_of_one_offered_is_no_choice(picture: object) -> None:
    fake = FakeAiFactory.answering(ChatReplyFactory.json_saying({"picture": picture, "why": "x"}))

    answer = chooser_over(fake).choose(THE_BEATLES)

    assert (answer.option, answer.why) == (None, "")


def test_a_line_break_in_the_artist_or_a_name_cannot_add_a_line_to_the_question() -> None:
    fake = FakeAiFactory.answering(ChatReplyFactory.json_saying({"picture": None}))
    request = THE_BEATLES.model_copy(
        update={"artist": "The\npictures:", "options": (PictureOption(name="a.\nb"),)}
    )

    chooser_over(fake).choose(request)

    _, user = fake.body()["messages"]
    assert user["content"].splitlines()[0] == "artist: The pictures: (Liverpool rock band, GB)"
    assert user["content"].splitlines()[-1] == "a. a. b"


def test_a_provider_refusing_the_key_is_a_refusal() -> None:
    fake = FakeAiFactory.answering(Reply(401))

    answer = chooser_over(fake).choose(THE_BEATLES)

    assert (answer.status, answer.option) == (FindStatus.REFUSED, None)


def test_a_provider_that_stays_busy_is_a_network_failure() -> None:
    fake = FakeAiFactory.answering(*[Reply(503)] * MAX_ATTEMPTS)

    with pytest.raises(NetworkError):
        chooser_over(fake).choose(THE_BEATLES)
