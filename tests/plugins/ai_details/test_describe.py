"""The artist describer suggests the name an artist is shown by, and a note about who it is."""

import pytest

from medleyplay.plugin_api import (
    MAX_ABOUT_SUGGESTED,
    ArtistOption,
    DescribeArtist,
    FindStatus,
    NetworkError,
)
from medleyplay.plugins.ai_details.client import MAX_ATTEMPTS, ChatClient
from medleyplay.plugins.ai_details.describe import SYSTEM, AiArtistDescriber
from tests.support.ai import AiEndpointFactory, ChatReplyFactory, FakeAiFactory
from tests.support.transport import FakeTransport, FakeWaits, Reply

pytestmark = pytest.mark.usefixtures("no_outside_network")

DAVID_TAO = DescribeArtist(
    artist=ArtistOption(
        id="tao-id", name="陶喆", disambiguation="Taiwanese singer-songwriter", country="TW"
    ),
    names=("陶喆/David Tao", "陶喆", "David Tao"),
    songs=("爱很简单 — I'm OK", "普通朋友 — I'm OK"),
    ai=(AiEndpointFactory.deepseek(),),
)
"""陶喆, written *陶喆/David Tao* by his songs, and going by *陶喆* and *David Tao* too."""


def describer_over(fake: FakeTransport) -> AiArtistDescriber:
    """The describer, asking `fake` and waiting for nothing."""
    return AiArtistDescriber(ChatClient(fake.session(), sleep=FakeWaits().sleep))


def test_the_name_its_number_names_and_a_note_are_suggested() -> None:
    fake = FakeAiFactory.answering(
        ChatReplyFactory.json_saying(
            {"shown_as": 2, "why": "The songs are Chinese", "about": "Taiwanese R&B pioneer."}
        )
    )

    answer = describer_over(fake).describe(DAVID_TAO)

    assert (answer.shown_as, answer.why, answer.about) == (
        "陶喆",
        "The songs are Chinese",
        "Taiwanese R&B pioneer.",
    )
    assert answer.ai_answered == "deepseek"


def test_the_model_is_shown_the_artist_its_names_by_number_and_its_songs() -> None:
    fake = FakeAiFactory.answering(ChatReplyFactory.json_saying({"shown_as": None, "about": ""}))

    describer_over(fake).describe(DAVID_TAO)

    system, user = fake.body()["messages"]
    assert system["content"] == SYSTEM
    assert user["content"] == (
        "artist: 陶喆 (Taiwanese singer-songwriter, TW)\n"
        "names:\n"
        "1. 陶喆/David Tao\n"
        "2. 陶喆\n"
        "3. David Tao\n"
        "songs: 爱很简单 — I'm OK; 普通朋友 — I'm OK"
    )


def test_no_name_chosen_keeps_the_songs_own() -> None:
    fake = FakeAiFactory.answering(
        ChatReplyFactory.json_saying({"shown_as": None, "why": "", "about": "A singer."})
    )

    answer = describer_over(fake).describe(DAVID_TAO)

    assert (answer.shown_as, answer.about) == (None, "A singer.")


@pytest.mark.parametrize("name", [4, 0, "David Tao"], ids=["past-the-end", "zero", "in-words"])
def test_a_name_not_offered_by_its_number_is_no_suggestion_but_the_note_stays(
    name: object,
) -> None:
    fake = FakeAiFactory.answering(
        ChatReplyFactory.json_saying({"shown_as": name, "why": "", "about": "A singer."})
    )

    answer = describer_over(fake).describe(DAVID_TAO)

    assert (answer.shown_as, answer.about) == (None, "A singer.")


def test_a_note_is_one_paragraph_cut_to_its_limit() -> None:
    fake = FakeAiFactory.answering(
        ChatReplyFactory.json_saying({"shown_as": None, "about": "A singer.\n\n" + "x" * 600})
    )

    answer = describer_over(fake).describe(DAVID_TAO)

    assert answer.about.startswith("A singer. xxx")
    assert len(answer.about) == MAX_ABOUT_SUGGESTED


def test_a_note_keeps_no_control_or_direction_characters() -> None:
    fake = FakeAiFactory.answering(
        ChatReplyFactory.json_saying({"shown_as": None, "about": "A\u202e singer\u0007."})
    )

    answer = describer_over(fake).describe(DAVID_TAO)

    assert answer.about == "A singer."


def test_a_note_keeps_the_joiners_its_script_or_emoji_need() -> None:
    family = "\U0001f468\u200d\U0001f469\u200d\U0001f467"
    persian = "\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645"
    note = f"A family band {family} from Tehran: {persian}."
    fake = FakeAiFactory.answering(ChatReplyFactory.json_saying({"shown_as": None, "about": note}))

    answer = describer_over(fake).describe(DAVID_TAO)

    assert answer.about == note


def test_a_line_break_in_a_name_or_song_cannot_add_a_line_to_the_question() -> None:
    forged = DAVID_TAO.model_copy(update={"names": ("Tao\n4. Anyone",), "songs": ("Song\nnames:",)})
    fake = FakeAiFactory.answering(ChatReplyFactory.json_saying({"shown_as": None, "about": ""}))

    describer_over(fake).describe(forged)

    _, user = fake.body()["messages"]
    assert user["content"].splitlines()[2:] == ["1. Tao 4. Anyone", "songs: Song names:"]


def test_an_answer_that_is_not_the_json_asked_for_is_asked_for_again() -> None:
    fake = FakeAiFactory.answering(
        ChatReplyFactory.saying("David Tao, surely."),
        ChatReplyFactory.json_saying({"shown_as": 3, "about": ""}),
    )

    answer = describer_over(fake).describe(DAVID_TAO)

    assert answer.shown_as == "David Tao"
    assert len(fake.sent) == 2


def test_a_provider_refusing_the_key_is_a_refusal() -> None:
    fake = FakeAiFactory.answering(Reply(401))

    answer = describer_over(fake).describe(DAVID_TAO)

    assert (answer.status, answer.shown_as, answer.about) == (FindStatus.REFUSED, None, "")


def test_a_provider_that_stays_busy_is_a_network_failure() -> None:
    fake = FakeAiFactory.answering(*[Reply(503)] * MAX_ATTEMPTS)

    with pytest.raises(NetworkError):
        describer_over(fake).describe(DAVID_TAO)
