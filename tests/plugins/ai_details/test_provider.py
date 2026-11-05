"""The enricher turns what a model says into suggestions, and fails as the provider does."""

import json
from pathlib import Path

import pytest
import requests

from medleyplay.plugin_api import (
    AiEndpoint,
    Enriched,
    EnrichStatus,
    EnrichTrack,
    NetworkError,
    SuggestedSong,
)
from medleyplay.plugin_api.testing import check_track_enricher
from medleyplay.plugins.ai_details.client import MAX_ATTEMPTS, ChatClient
from medleyplay.plugins.ai_details.prompt import SYSTEM
from medleyplay.plugins.ai_details.provider import AiDetails
from tests.support.ai import (
    CHAT,
    KEY,
    AiEndpointFactory,
    ChatReplyFactory,
    FakeAiFactory,
)
from tests.support.factories import EnrichTrackFactory
from tests.support.transport import FakeTransport, FakeWaits, Reply

pytestmark = pytest.mark.usefixtures("no_outside_network")

NIGHT_DRIVE = {
    "title": "Night Drive",
    "artist": "Blue Room",
    "album": "Re:Start",
    "year": 2016,
}


def enricher_over(fake: FakeTransport) -> AiDetails:
    """The enricher, asking `fake` and waiting for nothing."""
    return AiDetails(ChatClient(fake.session(), sleep=FakeWaits().sleep))


def ask_about_night_drive(tmp_path: Path, ai: AiEndpoint | None = None) -> EnrichTrack:
    return EnrichTrackFactory.night_drive_video(tmp_path, ai or AiEndpointFactory.deepseek())


def enrich(fake: FakeTransport, tmp_path: Path) -> Enriched:
    """Ask the enricher about *Night Drive*, answered by `fake`."""
    return enricher_over(fake).enrich(ask_about_night_drive(tmp_path))


# What is suggested


def test_a_song_answer_becomes_values_and_no_songs(tmp_path: Path) -> None:
    answer = enrich(FakeAiFactory.answering(ChatReplyFactory.night_drive()), tmp_path)

    assert (answer.status, answer.values, answer.songs) == (EnrichStatus.OK, NIGHT_DRIVE, ())


def test_an_album_answer_becomes_values_and_a_song_list(tmp_path: Path) -> None:
    request = EnrichTrackFactory.night_drive_video(
        tmp_path, AiEndpointFactory.deepseek(), text=EnrichTrackFactory.album_text()
    )
    fake = FakeAiFactory.answering(ChatReplyFactory.album())

    answer = enricher_over(fake).enrich(request)

    assert answer.values == {"artist": "Blue Room", "album": "Re:Start", "year": 2016}
    assert answer.songs == (
        SuggestedSong(start_ms=0, title="Intro"),
        SuggestedSong(start_ms=192_000, title="Night Drive", artist="Blue Room"),
        SuggestedSong(start_ms=4_060_000, title="Outro"),
    )


def test_the_answer_keeps_the_enrich_contract(tmp_path: Path) -> None:
    fake = FakeAiFactory.answering(ChatReplyFactory.night_drive())

    answer = check_track_enricher(enricher_over(fake), ask_about_night_drive(tmp_path))

    assert answer.cover is None


def test_the_model_is_sent_the_videos_text_and_the_shape_of_the_answer(tmp_path: Path) -> None:
    fake = FakeAiFactory.answering(ChatReplyFactory.night_drive())

    enrich(fake, tmp_path)

    system, user = fake.body()["messages"]
    assert system["content"] == SYSTEM
    assert "json" in system["content"].lower()
    assert "【MV】Night Drive / Blue Room" in user["content"]
    assert "BV1dm4y1s7ak.m4a" in user["content"]


def test_the_key_is_in_the_header_alone(tmp_path: Path) -> None:
    fake = FakeAiFactory.answering(ChatReplyFactory.night_drive())

    enrich(fake, tmp_path)

    assert fake.sent[0].headers["Authorization"] == f"Bearer {KEY}"
    assert KEY not in json.dumps(fake.body())


def test_a_provider_without_a_key_is_asked_without_one(tmp_path: Path) -> None:
    fake = FakeAiFactory.answering(
        ChatReplyFactory.night_drive(), url="http://127.0.0.1:11434/v1/chat/completions"
    )

    answer = enricher_over(fake).enrich(ask_about_night_drive(tmp_path, AiEndpointFactory.ollama()))

    assert answer.values == NIGHT_DRIVE
    assert "Authorization" not in fake.sent[0].headers


# An answer that is not the JSON asked for


def _bad_then_good(bad: str) -> FakeTransport:
    return FakeAiFactory.answering(ChatReplyFactory.saying(bad), ChatReplyFactory.night_drive())


@pytest.mark.parametrize(
    "bad",
    ["Sure! It is Night Drive.", '{"title": "', '{"year": 99}', json.dumps({"title": "t" * 513})],
    ids=["words", "cut-off JSON", "a year out of range", "a title too long"],
)
def test_an_answer_that_does_not_validate_is_asked_for_once_more(tmp_path: Path, bad: str) -> None:
    fake = _bad_then_good(bad)

    answer = enrich(fake, tmp_path)

    assert (answer.status, answer.values) == (EnrichStatus.OK, NIGHT_DRIVE)
    assert len(fake.sent) == 2


def test_the_second_ask_shows_the_model_its_own_answer_and_what_was_wrong() -> None:
    fake = _bad_then_good('{"year": 99}')

    enricher_over(fake).enrich(ask_about_night_drive(Path()))

    roles = [message["role"] for message in fake.body(1)["messages"]]
    again = fake.body(1)["messages"]
    assert roles == ["system", "user", "assistant", "user"]
    assert again[2]["content"] == '{"year": 99}'
    assert "year" in again[3]["content"]


def test_an_answer_that_still_does_not_validate_is_invalid_after_one_retry(tmp_path: Path) -> None:
    fake = FakeAiFactory.answering(ChatReplyFactory.saying("Sure! It is Night Drive."))

    answer = enrich(fake, tmp_path)

    assert answer.status is EnrichStatus.INVALID
    assert "asked again" in answer.message
    assert len(fake.sent) == 2


def test_an_invalid_answer_holds_neither_the_key_nor_the_words_the_model_used(
    tmp_path: Path,
) -> None:
    fake = FakeAiFactory.answering(ChatReplyFactory.saying(f"My secret is {KEY}, Night Drive"))

    answer = enrich(fake, tmp_path)

    assert KEY not in answer.message
    assert "Night Drive" not in answer.message


def test_a_value_over_the_limits_is_never_cut_down_to_fit(tmp_path: Path) -> None:
    fake = FakeAiFactory.answering(ChatReplyFactory.json_saying({"title": "t" * 600}))

    answer = enrich(fake, tmp_path)

    assert (answer.status, answer.values) == (EnrichStatus.INVALID, {})


@pytest.mark.parametrize(
    "reply",
    [
        ChatReplyFactory.saying('{"title": "Night', finish_reason="length"),
        ChatReplyFactory.saying(""),
    ],
    ids=["cut off at the length limit", "empty"],
)
def test_an_answer_cut_off_or_empty_is_invalid_without_asking_again(
    tmp_path: Path, reply: Reply
) -> None:
    fake = FakeAiFactory.answering(reply)

    answer = enrich(fake, tmp_path)

    assert answer.status is EnrichStatus.INVALID
    assert len(fake.sent) == 1


def test_another_refusal_of_the_request_is_invalid_and_says_to_check_the_setup(
    tmp_path: Path,
) -> None:
    answer = enrich(FakeAiFactory.answering(Reply(404)), tmp_path)

    assert answer.status is EnrichStatus.INVALID
    assert "base URL and the model" in answer.message


# The provider refuses or fails


@pytest.mark.parametrize("status", [401, 403])
def test_a_key_the_provider_refuses_is_a_refusal_that_says_to_check_the_key(
    tmp_path: Path, status: int
) -> None:
    fake = FakeAiFactory.answering(Reply(status, body=f"bad key {KEY}".encode()))

    answer = enrich(fake, tmp_path)

    assert answer.status is EnrichStatus.REFUSED
    assert "Check the key" in answer.message
    assert KEY not in answer.message
    assert len(fake.sent) == 1


def test_a_provider_that_stays_busy_is_a_network_failure(tmp_path: Path) -> None:
    fake = FakeAiFactory.answering(Reply(429, {"Retry-After": "1"}))

    with pytest.raises(NetworkError, match="too busy"):
        enrich(fake, tmp_path)

    assert len(fake.sent) == MAX_ATTEMPTS


def test_a_provider_that_cannot_be_reached_is_a_network_failure(tmp_path: Path) -> None:
    fake = FakeAiFactory.answering(requests.ConnectionError(f"{CHAT} {KEY}"))

    with pytest.raises(NetworkError) as unreached:
        enrich(fake, tmp_path)

    assert KEY not in str(unreached.value)


# What the enricher is asked with


def test_an_ask_without_a_provider_is_a_fault_of_the_caller(tmp_path: Path) -> None:
    request = EnrichTrackFactory.night_drive_video(tmp_path, None)

    with pytest.raises(ValueError, match="text and a provider"):
        enricher_over(FakeTransport()).enrich(request)


def test_an_ask_without_the_videos_text_is_a_fault_of_the_caller(tmp_path: Path) -> None:
    request = EnrichTrack(ai=AiEndpointFactory.deepseek(), folder=str(tmp_path))

    with pytest.raises(ValueError, match="text and a provider"):
        enricher_over(FakeTransport()).enrich(request)
