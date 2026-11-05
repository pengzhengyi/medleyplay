"""The enricher: asks an AI model what a Track's video text says, and checks the answer."""

from dataclasses import dataclass, field

from medleyplay.plugin_api import AiEndpoint, Enriched, EnrichStatus, EnrichTrack
from medleyplay.plugins.ai_details.client import (
    ChatClient,
    Message,
    RefusedError,
    UnusableAnswerError,
)
from medleyplay.plugins.ai_details.models import Answer, BadAnswerError, parse_answer
from medleyplay.plugins.ai_details.prompt import asking, asking_again


@dataclass(frozen=True)
class AiDetails:
    """Asks an AI model for a Track's details and its song list, from its video text."""

    client: ChatClient = field(default_factory=ChatClient)

    def enrich(self, request: EnrichTrack) -> Enriched:
        """Ask the model about the Track, and return what it suggests.

        An answer that is not the JSON asked for is asked for once more; if it is still
        not, the answer is `INVALID`. A key or an account the provider refuses is a
        refusal; a provider that can't be reached or stays busy is a network failure,
        which is raised.
        """
        if request.ai is None or request.text is None:
            message = "ai-details is asked with a video's text and a provider."
            raise ValueError(message)
        try:
            answer = self._answer(request.ai, asking(request))
        except RefusedError as error:
            return Enriched(status=EnrichStatus.REFUSED, message=str(error))
        except (UnusableAnswerError, BadAnswerError) as error:
            return Enriched(status=EnrichStatus.INVALID, message=_invalid(error))
        return Enriched(values=answer.values(), songs=answer.suggested_songs())

    def _answer(self, ai: AiEndpoint, messages: list[Message]) -> Answer:
        said = self.client.complete(ai, messages)
        try:
            return parse_answer(said)
        except BadAnswerError as first:
            again = asking_again(messages, said, str(first))
        return parse_answer(self.client.complete(ai, again))


def _invalid(error: UnusableAnswerError | BadAnswerError) -> str:
    if isinstance(error, UnusableAnswerError):
        return str(error)
    return f"The AI model's answer was not the JSON asked for, even when asked again: {error}."
