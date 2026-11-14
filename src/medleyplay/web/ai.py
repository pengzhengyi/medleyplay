"""The AI API: an admin keeps the providers that suggest Track details, and no answer shows a key.

A key is read from the body as a secret, kept in the Keychain, and never answered:
the API shows only each provider's address, model, whether it has a key, and how it
last failed. Jobs ask the providers in the order shown.
"""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, status
from pydantic import BaseModel, ConfigDict, Field, SecretStr, StrictStr

from medleyplay.application.ai import SavedProvider
from medleyplay.domain.ai import (
    MAX_DESCRIPTION,
    MAX_KEY,
    MAX_MODEL,
    MAX_PROVIDERS,
    MAX_URL,
    PRESETS,
    ProviderFailure,
    UnusableReason,
)
from medleyplay.web.deps import AiDep, SignedInAccount

router = APIRouter(prefix="/api/ai", tags=["ai"])

type _Key = Annotated[SecretStr, Field(max_length=MAX_KEY)]
type _Model = Annotated[StrictStr, Field(max_length=MAX_MODEL)]


class ProviderIn(BaseModel):
    """A provider to add: its base URL, the model to ask, and its key if it needs one."""

    model_config = ConfigDict(extra="forbid")

    base_url: Annotated[StrictStr, Field(max_length=MAX_URL)] = Field(
        examples=["https://api.deepseek.com"]
    )
    model: _Model = Field(examples=["deepseek-flash"])
    key: _Key | None = None
    """Left out or `null` for a provider that needs no key, such as a local Ollama."""


class KeyIn(BaseModel):
    """A provider's new key."""

    model_config = ConfigDict(extra="forbid")

    key: _Key


class ModelIn(BaseModel):
    """The model a provider is asked from now on."""

    model_config = ConfigDict(extra="forbid")

    model: _Model


class OrderIn(BaseModel):
    """Every provider's id, in the order they are asked."""

    model_config = ConfigDict(extra="forbid")

    ids: Annotated[
        list[Annotated[StrictStr, Field(max_length=32)]], Field(max_length=MAX_PROVIDERS)
    ]


class ProviderOut(BaseModel):
    """A provider as the API shows it; its key never leaves the server."""

    id: str
    base_url: str
    model: str
    has_key: bool
    saved_at: datetime
    failure: ProviderFailure | None
    """Why it last gave no answer to use, until it answers again."""
    failed_at: datetime | None
    failure_reason: UnusableReason | None
    """What was wrong with its answer, when it was unusable."""
    failure_status: int | None
    """The status it refused the request with, when it refused one."""

    @classmethod
    def of(cls, saved: SavedProvider) -> "ProviderOut":
        """Return the API view of `saved`."""
        return cls(
            id=saved.id,
            base_url=saved.base_url,
            model=saved.model,
            has_key=saved.has_key,
            saved_at=saved.saved_at,
            failure=saved.failure,
            failed_at=saved.failed_at,
            failure_reason=saved.failure_reason,
            failure_status=saved.failure_status,
        )


class PresetOut(BaseModel):
    """A provider to start from: its name, base URL, and a model to ask."""

    name: str
    base_url: str
    model: str


class AiOut(BaseModel):
    """The providers in the order asked, the presets, and the limits."""

    providers: list[ProviderOut]
    presets: list[PresetOut]
    max_providers: int
    max_description: int
    """The most characters of a video's description sent to a provider."""


@router.get("")
def get_ai(me: SignedInAccount, ai: AiDep) -> AiOut:
    """Return the providers in the order they are asked, and the presets; admins only."""
    return AiOut(
        providers=[ProviderOut.of(each) for each in ai.providers(me)],
        presets=[
            PresetOut(name=each.name, base_url=each.base_url, model=each.model) for each in PRESETS
        ],
        max_providers=MAX_PROVIDERS,
        max_description=MAX_DESCRIPTION,
    )


@router.post("/providers", status_code=status.HTTP_201_CREATED)
def add_provider(body: ProviderIn, me: SignedInAccount, ai: AiDep) -> ProviderOut:
    """Add a provider after the others; 409 for one set up already or one too many."""
    key = None if body.key is None else body.key.get_secret_value()
    return ProviderOut.of(ai.add(me, body.base_url, body.model, key))


@router.put("/providers/{provider_id}/key")
def replace_key(provider_id: str, body: KeyIn, me: SignedInAccount, ai: AiDep) -> ProviderOut:
    """Replace the provider's key, keeping its place; 404 when it is gone."""
    return ProviderOut.of(ai.replace_key(me, provider_id, body.key.get_secret_value()))


@router.put("/providers/{provider_id}/model")
def change_model(provider_id: str, body: ModelIn, me: SignedInAccount, ai: AiDep) -> ProviderOut:
    """Ask another model of the provider, keeping its place and key; 404 when it is gone."""
    return ProviderOut.of(ai.change_model(me, provider_id, body.model))


@router.put("/order")
def reorder(body: OrderIn, me: SignedInAccount, ai: AiDep) -> list[ProviderOut]:
    """Ask the providers in the order given; 409 when it names other providers than there are."""
    return [ProviderOut.of(each) for each in ai.reorder(me, body.ids)]


@router.delete("/providers/{provider_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_provider(provider_id: str, me: SignedInAccount, ai: AiDep) -> None:
    """Forget the provider and its key; 204 also when it is gone."""
    ai.remove(me, provider_id)
