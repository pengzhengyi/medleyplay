"""Asking the AI providers in turn: the first to answer with what was asked for wins.

A provider that can't be reached, stays busy, refuses the key, or answers with nothing
to use is passed over for the next; only the last is waited for while busy. An answer
that is not the JSON asked for is asked for once more, saying what was wrong.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass

from medleyplay.plugin_api import (
    AiEndpoint,
    AiFailure,
    AiFailureKind,
    AiFailureReason,
    NetworkError,
)
from medleyplay.plugins.ai_details.client import (
    BusyError,
    ChatClient,
    Message,
    RefusedError,
    UnusableAnswerError,
)
from medleyplay.plugins.ai_details.models import BadAnswerError
from medleyplay.plugins.ai_details.prompt import asking_again


@dataclass(frozen=True)
class Failed:
    """A provider that gave no answer to use: why, and what it was told or said."""

    provider: AiEndpoint
    kind: AiFailureKind
    message: str
    reason: AiFailureReason | None = None
    status: int | None = None


@dataclass(frozen=True)
class Answered[A]:
    """What the first provider to answer said, and the providers passed over before it."""

    answer: A
    provider: AiEndpoint
    failed: tuple[Failed, ...]


def ask_in_turn[A](
    client: ChatClient,
    ais: Sequence[AiEndpoint],
    messages: list[Message],
    parse: Callable[[str], A],
) -> Answered[A] | tuple[Failed, ...]:
    """Ask each provider of `ais` in turn; return the first answer `parse` reads, or every failure.

    `parse` raises `BadAnswerError` naming what is wrong with an answer.
    """
    failed: list[Failed] = []
    for place, ai in enumerate(ais, start=1):
        outcome = _try(client, ai, messages, parse, patient=place == len(ais))
        if isinstance(outcome, Failed):
            failed.append(outcome)
            continue
        return Answered(outcome, ai, tuple(failed))
    return tuple(failed)


def raise_unreachable(failed: Sequence[Failed]) -> None:
    """Raise `NetworkError` when any provider couldn't be reached or stayed busy."""
    if {each.kind for each in failed} & {AiFailureKind.UNREACHABLE, AiFailureKind.BUSY}:
        raise NetworkError(message_of(failed))


def all_refused(failed: Sequence[Failed]) -> bool:
    """Return whether every provider refused the key or the account."""
    return bool(failed) and {each.kind for each in failed} == {AiFailureKind.REFUSED}


def message_of(failed: Sequence[Failed]) -> str:
    """Say why no provider answered: the one reason, or each provider's in turn."""
    if len(failed) == 1:
        return failed[0].message
    each = " ".join(f"{place}. {one.message}" for place, one in enumerate(failed, start=1))
    return f"No AI provider answered. {each}"


def failures_of(failed: Sequence[Failed]) -> tuple[AiFailure, ...]:
    """Return the failures as the plugin API reports them."""
    return tuple(
        AiFailure(provider=each.provider.id, kind=each.kind, reason=each.reason, status=each.status)
        for each in failed
    )


def _try[A](
    client: ChatClient,
    ai: AiEndpoint,
    messages: list[Message],
    parse: Callable[[str], A],
    *,
    patient: bool,
) -> A | Failed:
    try:
        return _answer(client, ai, messages, parse, patient=patient)
    except RefusedError as error:
        return Failed(ai, AiFailureKind.REFUSED, str(error))
    except BusyError as error:
        return Failed(ai, AiFailureKind.BUSY, str(error))
    except NetworkError as error:
        return Failed(ai, AiFailureKind.UNREACHABLE, str(error))
    except UnusableAnswerError as error:
        return Failed(ai, AiFailureKind.UNUSABLE, str(error), error.reason, error.status)
    except BadAnswerError as error:
        return Failed(ai, AiFailureKind.UNUSABLE, _invalid(error), AiFailureReason.NOT_JSON)


def _answer[A](
    client: ChatClient,
    ai: AiEndpoint,
    messages: list[Message],
    parse: Callable[[str], A],
    *,
    patient: bool,
) -> A:
    said = client.complete(ai, messages, patient=patient)
    try:
        return parse(said)
    except BadAnswerError as first:
        again = asking_again(messages, said, str(first))
    return parse(client.complete(ai, again, patient=patient))


def _invalid(error: BadAnswerError) -> str:
    return f"The AI model's answer was not the JSON asked for, even when asked again: {error}."
