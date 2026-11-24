"""The narrow request and reply for suggesting missing music details."""

from datetime import timedelta
from typing import Annotated, Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from medleyplay.plugin_api.enrichers import AiEndpoint
from medleyplay.plugin_api.extension import ExtensionPoint

type MissingField = Literal["artist", "album", "album_artist"]
type ClueField = Literal["title", "artist", "album", "album_artist"]
type CreditText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=512)
]


class CreditClues(BaseModel):
    """Names already known about one Track, and the fields to suggest."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    kind: Literal["song", "album"]
    known: dict[ClueField, CreditText]
    missing: Annotated[tuple[MissingField, ...], Field(min_length=1, max_length=2)]


class SuggestMissingDetails(BaseModel):
    """Ask the configured providers about a Track's missing details."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    clues: CreditClues
    ai: tuple[AiEndpoint, ...] = Field(default=(), repr=False)


class SuggestedMissingDetails(BaseModel):
    """Return one candidate per field, or none when the provider is unsure."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    status: Literal["ok", "refused", "invalid"] = "ok"
    message: Annotated[str, StringConstraints(max_length=500)] = ""
    values: dict[MissingField, CreditText] = Field(default_factory=dict)


class MissingDetailsSuggester(Protocol):
    """Suggest missing credits without changing the catalog."""

    def suggest(self, request: SuggestMissingDetails) -> SuggestedMissingDetails:
        """Return candidates from the Track's known details."""
        ...


MISSING_DETAILS_SUGGESTER = ExtensionPoint[MissingDetailsSuggester]("missing_details_suggester")
SUGGEST_MISSING_DETAILS = MISSING_DETAILS_SUGGESTER.operation(
    "suggest",
    SuggestMissingDetails,
    SuggestedMissingDetails,
    lambda suggester: suggester.suggest,
    deadline=timedelta(minutes=5),
)
