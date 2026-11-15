"""The enricher: asks AI models in turn what a Track's video text says, and checks the answer."""

from dataclasses import dataclass, field

from medleyplay.plugin_api import Enriched, EnrichStatus, EnrichTrack
from medleyplay.plugins.ai_details.client import ChatClient
from medleyplay.plugins.ai_details.copilot import chat_client
from medleyplay.plugins.ai_details.models import parse_answer
from medleyplay.plugins.ai_details.prompt import asking
from medleyplay.plugins.ai_details.turns import (
    Failed,
    all_refused,
    ask_in_turn,
    failures_of,
    message_of,
    raise_unreachable,
)


@dataclass(frozen=True)
class AiDetails:
    """Asks AI models for a Track's details and its song list, from its video text."""

    client: ChatClient = field(default_factory=chat_client)

    def enrich(self, request: EnrichTrack) -> Enriched:
        """Ask the providers about the Track in turn, and return what the first to answer says.

        A provider that can't be reached, stays busy, refuses the key, or answers with
        nothing to use is passed over for the next; only the last is waited for while
        busy. An answer that is not the JSON asked for is asked for once more. When none
        answers, a refusal by every one is a refusal, any that couldn't be reached or
        stayed busy is a network failure, which is raised, and otherwise it is `INVALID`.
        """
        if not request.ai or request.text is None:
            message = "ai-details is asked with a video's text and a provider."
            raise ValueError(message)
        outcome = ask_in_turn(self.client, request.ai, asking(request), parse_answer)
        if isinstance(outcome, tuple):
            return _none_answered(outcome)
        return Enriched(
            values=outcome.answer.values(),
            songs=outcome.answer.suggested_songs(),
            ai_answered=outcome.provider.id,
            ai_failures=failures_of(outcome.failed),
        )


def _none_answered(failed: tuple[Failed, ...]) -> Enriched:
    raise_unreachable(failed)
    status = EnrichStatus.REFUSED if all_refused(failed) else EnrichStatus.INVALID
    return Enriched(status=status, message=message_of(failed), ai_failures=failures_of(failed))
