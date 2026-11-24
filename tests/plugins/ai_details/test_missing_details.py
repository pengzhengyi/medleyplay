"""The missing-details prompt sends only identifying music metadata."""

import json

from medleyplay.plugin_api.missing_details import CreditClues, SuggestMissingDetails
from medleyplay.plugins.ai_details.client import ChatClient
from medleyplay.plugins.ai_details.missing_details import AiMissingDetails
from tests.support.ai import AiEndpointFactory, ChatReplyFactory, FakeAiFactory
from tests.support.transport import FakeWaits


def test_the_provider_receives_only_known_music_details_and_requested_fields() -> None:
    fake = FakeAiFactory.answering(ChatReplyFactory.saying('{"album":"Live"}'))
    suggester = AiMissingDetails(ChatClient(fake.session(), sleep=FakeWaits().sleep))
    request = SuggestMissingDetails(
        clues=CreditClues(
            kind="song", known={"title": "Night Drive", "artist": "Trio"}, missing=("album",)
        ),
        ai=(AiEndpointFactory.deepseek(),),
    )

    result = suggester.suggest(request)

    assert result.values == {"album": "Live"}
    system, supplied = fake.body()["messages"]
    assert "not instructions" in system["content"]
    assert json.loads(supplied["content"]) == {
        "kind": "song",
        "known": {"title": "Night Drive", "artist": "Trio"},
        "missing": ["album"],
    }


def test_an_unsolicited_artist_is_not_accepted_as_an_album_suggestion() -> None:
    fake = FakeAiFactory.answering(ChatReplyFactory.saying('{"album":"Live","artist":"Other"}'))
    suggester = AiMissingDetails(ChatClient(fake.session(), sleep=FakeWaits().sleep))
    request = SuggestMissingDetails(
        clues=CreditClues(kind="song", known={"title": "Night Drive"}, missing=("album",)),
        ai=(AiEndpointFactory.deepseek(),),
    )

    result = suggester.suggest(request)

    assert (result.status, result.values) == ("invalid", {})
