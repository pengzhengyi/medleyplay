"""The lyrics chooser picks which song found is the song, and why, never seeing words."""

import pytest

from medleyplay.plugin_api import (
    ChooseLyrics,
    FindStatus,
    LyricsChoice,
    LyricsProvider,
    NetworkError,
)
from medleyplay.plugins.ai_details.client import MAX_ATTEMPTS, ChatClient
from medleyplay.plugins.ai_details.lyrics import SYSTEM, AiLyricsChooser
from tests.support.ai import AiEndpointFactory, ChatReplyFactory, FakeAiFactory
from tests.support.transport import FakeTransport, FakeWaits, Reply

pytestmark = pytest.mark.usefixtures("no_outside_network")

MELT = ChooseLyrics(
    title="Melt",
    artist="ryo",
    album="Re:Start",
    duration_ms=260_400,
    options=(
        LyricsChoice(
            provider=LyricsProvider.LRCLIB,
            title="Melt",
            artist="ryo",
            album="Re:Start",
            duration_ms=260_000,
            timed=True,
        ),
        LyricsChoice(
            provider=LyricsProvider.LRCLIB, title="Melt (Live)", artist="ryo", duration_ms=301_000
        ),
        LyricsChoice(
            provider=LyricsProvider.NETEASE,
            title="Melt (Off Vocal)",
            artist="ryo",
            instrumental=True,
        ),
    ),
    ai=(AiEndpointFactory.deepseek(),),
)
"""*Melt* by ryo, 4:20 long, found as its studio recording, a live take, and its off vocal."""


def chooser_over(fake: FakeTransport) -> AiLyricsChooser:
    """The chooser, asking `fake` and waiting for nothing."""
    return AiLyricsChooser(ChatClient(fake.session(), sleep=FakeWaits().sleep))


def test_the_song_its_letter_names_is_chosen_with_why() -> None:
    fake = FakeAiFactory.answering(
        ChatReplyFactory.json_saying({"song": "a", "why": "The studio recording"})
    )

    answer = chooser_over(fake).choose(MELT)

    assert (answer.option, answer.why, answer.ai_answered) == (
        0,
        "The studio recording",
        "deepseek",
    )


def test_the_model_is_shown_the_song_and_each_song_found_by_letter_without_words() -> None:
    fake = FakeAiFactory.answering(ChatReplyFactory.json_saying({"song": None}))

    chooser_over(fake).choose(MELT)

    system, user = fake.body()["messages"]
    assert system["content"] == SYSTEM
    assert user["content"] == (
        "song: Melt — ryo (Re:Start, 4:20)\n"
        "found:\n"
        "a. Melt — ryo (LRCLIB, Re:Start, 4:20, timed)\n"
        "b. Melt (Live) — ryo (LRCLIB, 5:01, plain)\n"
        "c. Melt (Off Vocal) — ryo (NetEase, instrumental)"
    )


@pytest.mark.parametrize("song", [None, "d", 0, "Melt"], ids=["none", "past", "number", "title"])
def test_a_song_not_named_by_the_letter_of_one_offered_is_no_choice(song: object) -> None:
    fake = FakeAiFactory.answering(ChatReplyFactory.json_saying({"song": song, "why": "x"}))

    answer = chooser_over(fake).choose(MELT)

    assert (answer.option, answer.why) == (None, "")


def test_a_line_break_in_a_name_cannot_add_a_line_to_the_question() -> None:
    fake = FakeAiFactory.answering(ChatReplyFactory.json_saying({"song": None}))
    request = MELT.model_copy(update={"title": "Melt\nfound:", "album": ""})

    chooser_over(fake).choose(request)

    _, user = fake.body()["messages"]
    assert user["content"].splitlines()[0] == "song: Melt found: — ryo (4:20)"


def test_a_provider_refusing_the_key_is_a_refusal() -> None:
    fake = FakeAiFactory.answering(Reply(401))

    answer = chooser_over(fake).choose(MELT)

    assert (answer.status, answer.option) == (FindStatus.REFUSED, None)


def test_a_provider_that_stays_busy_is_a_network_failure() -> None:
    fake = FakeAiFactory.answering(*[Reply(503)] * MAX_ATTEMPTS)

    with pytest.raises(NetworkError):
        chooser_over(fake).choose(MELT)
