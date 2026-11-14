"""The enricher: asks AI models in turn what a Track's video text says, and checks the answer."""

from dataclasses import dataclass, field

from medleyplay.plugin_api import (
    AiEndpoint,
    AiFailure,
    AiFailureKind,
    AiFailureReason,
    Enriched,
    EnrichStatus,
    EnrichTrack,
    NetworkError,
)
from medleyplay.plugins.ai_details.client import (
    BusyError,
    ChatClient,
    Message,
    RefusedError,
    UnusableAnswerError,
)
from medleyplay.plugins.ai_details.models import Answer, BadAnswerError, parse_answer
from medleyplay.plugins.ai_details.prompt import asking, asking_again


@dataclass(frozen=True)
class _Failed:
    """A provider that gave no answer to use: why, and what it was told or said."""

    provider: AiEndpoint
    kind: AiFailureKind
    message: str
    reason: AiFailureReason | None = None
    status: int | None = None


@dataclass(frozen=True)
class AiDetails:
    """Asks AI models for a Track's details and its song list, from its video text."""

    client: ChatClient = field(default_factory=ChatClient)

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
        messages = asking(request)
        failed: list[_Failed] = []
        for place, ai in enumerate(request.ai, start=1):
            outcome = self._try(ai, messages, patient=place == len(request.ai))
            if isinstance(outcome, _Failed):
                failed.append(outcome)
                continue
            return Enriched(
                values=outcome.values(),
                songs=outcome.suggested_songs(),
                ai_answered=ai.id,
                ai_failures=_failures_of(failed),
            )
        return _none_answered(failed)

    def _try(self, ai: AiEndpoint, messages: list[Message], *, patient: bool) -> Answer | _Failed:
        try:
            return self._answer(ai, messages, patient=patient)
        except RefusedError as error:
            return _Failed(ai, AiFailureKind.REFUSED, str(error))
        except BusyError as error:
            return _Failed(ai, AiFailureKind.BUSY, str(error))
        except NetworkError as error:
            return _Failed(ai, AiFailureKind.UNREACHABLE, str(error))
        except UnusableAnswerError as error:
            return _Failed(ai, AiFailureKind.UNUSABLE, str(error), error.reason, error.status)
        except BadAnswerError as error:
            return _Failed(ai, AiFailureKind.UNUSABLE, _invalid(error), AiFailureReason.NOT_JSON)

    def _answer(self, ai: AiEndpoint, messages: list[Message], *, patient: bool) -> Answer:
        said = self.client.complete(ai, messages, patient=patient)
        try:
            return parse_answer(said)
        except BadAnswerError as first:
            again = asking_again(messages, said, str(first))
        return parse_answer(self.client.complete(ai, again, patient=patient))


def _none_answered(failed: list[_Failed]) -> Enriched:
    kinds = {each.kind for each in failed}
    message = _message_of(failed)
    if kinds & {AiFailureKind.UNREACHABLE, AiFailureKind.BUSY}:
        raise NetworkError(message)
    status = EnrichStatus.REFUSED if kinds == {AiFailureKind.REFUSED} else EnrichStatus.INVALID
    return Enriched(status=status, message=message, ai_failures=_failures_of(failed))


def _message_of(failed: list[_Failed]) -> str:
    if len(failed) == 1:
        return failed[0].message
    each = " ".join(f"{place}. {one.message}" for place, one in enumerate(failed, start=1))
    return f"No AI provider answered. {each}"


def _failures_of(failed: list[_Failed]) -> tuple[AiFailure, ...]:
    return tuple(
        AiFailure(provider=each.provider.id, kind=each.kind, reason=each.reason, status=each.status)
        for each in failed
    )


def _invalid(error: BadAnswerError) -> str:
    return f"The AI model's answer was not the JSON asked for, even when asked again: {error}."
