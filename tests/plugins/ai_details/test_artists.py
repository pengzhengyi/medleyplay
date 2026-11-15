"""The artist chooser asks which offered artist each name names, and keeps only real choices."""

import pytest

from medleyplay.plugin_api import (
    ArtistOption,
    ChooseArtists,
    ChosenArtist,
    FindStatus,
    NameToChoose,
    NetworkError,
)
from medleyplay.plugins.ai_details.artists import SYSTEM, AiArtistChooser
from medleyplay.plugins.ai_details.client import MAX_ATTEMPTS, ChatClient
from tests.support.ai import AiEndpointFactory, ChatReplyFactory, FakeAiFactory
from tests.support.transport import FakeTransport, FakeWaits, Reply

pytestmark = pytest.mark.usefixtures("no_outside_network")

GUMI = ArtistOption(id="gumi-id", name="GUMI", disambiguation="Vocaloid/SynthV", country="JP")
MAYU = ArtistOption(id="mayu-id", name="MAYU", disambiguation="Belly dancer", country="JP")
BEATLES = ArtistOption(id="beatles-id", name="The Beatles", country="GB")

GUMI_MAYU = NameToChoose(
    name="GUMI/MAYU", songs=("ケビョウニンゲン — ケビョウニンゲン",), options=(GUMI, MAYU)
)
"""*GUMI/MAYU*, a Vocaloid song, which may name GUMI, a voice, or MAYU, a dancer."""
JAY = NameToChoose(name="周杰伦", songs=("可爱女人 — Jay",), options=(BEATLES,))
"""*周杰伦*, offered only The Beatles, which he is not."""


def chooser_over(fake: FakeTransport) -> AiArtistChooser:
    """The chooser, asking `fake` and waiting for nothing."""
    return AiArtistChooser(ChatClient(fake.session(), sleep=FakeWaits().sleep))


def ask(*names: NameToChoose) -> ChooseArtists:
    """Ask DeepSeek about `names`."""
    return ChooseArtists(names=names, ai=(AiEndpointFactory.deepseek(),))


def test_each_name_gets_the_artist_its_letter_names_or_none() -> None:
    fake = FakeAiFactory.answering(
        ChatReplyFactory.json_saying(
            {
                "choices": [
                    {"name": 1, "artist": "a", "why": "GUMI is a Vocaloid voice"},
                    {"name": 2, "artist": None, "why": "Jay Chou is not The Beatles"},
                ]
            }
        )
    )

    answer = chooser_over(fake).choose(ask(GUMI_MAYU, JAY))

    assert answer.chosen == (
        ChosenArtist(name="GUMI/MAYU", artist_id="gumi-id", why="GUMI is a Vocaloid voice"),
        ChosenArtist(name="周杰伦", artist_id=None, why="Jay Chou is not The Beatles"),
    )
    assert answer.ai_answered == "deepseek"


def test_the_model_is_shown_each_name_its_songs_and_its_artists_by_letter() -> None:
    fake = FakeAiFactory.answering(ChatReplyFactory.json_saying({"choices": []}))

    chooser_over(fake).choose(ask(GUMI_MAYU))

    system, user = fake.body()["messages"]
    assert system["content"] == SYSTEM
    assert user["content"] == (
        "1. GUMI/MAYU\n"
        "   songs: ケビョウニンゲン — ケビョウニンゲン\n"
        "   a. GUMI (Vocaloid/SynthV, JP)\n"
        "   b. MAYU (Belly dancer, JP)"
    )


@pytest.mark.parametrize(
    "choice",
    [
        {"name": 3, "artist": "a", "why": "no third name"},
        {"name": 1, "artist": "c", "why": "no third artist"},
        {"name": 1, "artist": "gumi-id", "why": "an id, not a letter"},
    ],
)
def test_a_choice_of_a_name_or_artist_not_offered_is_left_out(choice: dict[str, object]) -> None:
    fake = FakeAiFactory.answering(ChatReplyFactory.json_saying({"choices": [choice]}))

    answer = chooser_over(fake).choose(ask(GUMI_MAYU))

    assert answer.chosen == ()


def test_an_answer_that_is_not_the_json_asked_for_is_asked_for_again() -> None:
    fake = FakeAiFactory.answering(
        ChatReplyFactory.saying("GUMI, surely."),
        ChatReplyFactory.json_saying({"choices": [{"name": 1, "artist": "a", "why": ""}]}),
    )

    answer = chooser_over(fake).choose(ask(GUMI_MAYU))

    assert [each.artist_id for each in answer.chosen] == ["gumi-id"]
    assert len(fake.sent) == 2


def test_a_provider_refusing_the_key_is_a_refusal() -> None:
    fake = FakeAiFactory.answering(Reply(401))

    answer = chooser_over(fake).choose(ask(GUMI_MAYU))

    assert (answer.status, answer.chosen) == (FindStatus.REFUSED, ())


def test_a_provider_that_stays_busy_is_a_network_failure() -> None:
    fake = FakeAiFactory.answering(*[Reply(503)] * MAX_ATTEMPTS)

    with pytest.raises(NetworkError):
        chooser_over(fake).choose(ask(GUMI_MAYU))
