"""The AI API: an admin sets the provider that suggests Track details, and no answer shows its key.

The key is read from the body as a secret, kept in the Keychain, and never answered:
the API shows only the address, the model, and whether there is a key.
"""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, status
from pydantic import BaseModel, ConfigDict, Field, SecretStr, StrictStr

from medleyplay.application.ai import AiSetting
from medleyplay.domain.ai import MAX_DESCRIPTION, MAX_KEY, MAX_MODEL, MAX_URL, PRESETS
from medleyplay.web.deps import AiDep, SignedInAccount

router = APIRouter(prefix="/api/ai", tags=["ai"])


class AiIn(BaseModel):
    """The provider to set: its base URL, the model to ask, and a key if it has a new one."""

    model_config = ConfigDict(extra="forbid")

    base_url: Annotated[StrictStr, Field(max_length=MAX_URL)] = Field(
        examples=["https://api.deepseek.com"]
    )
    model: Annotated[StrictStr, Field(max_length=MAX_MODEL)] = Field(examples=["deepseek-chat"])
    key: Annotated[SecretStr, Field(max_length=MAX_KEY)] | None = None
    """Left out or `null`, the key the provider has stays."""


class ProviderOut(BaseModel):
    """The provider as the API shows it; its key never leaves the server."""

    base_url: str
    model: str
    has_key: bool
    saved_at: datetime

    @classmethod
    def of(cls, setting: AiSetting) -> "ProviderOut":
        """Return the API view of `setting`."""
        return cls(
            base_url=setting.base_url,
            model=setting.model,
            has_key=setting.has_key,
            saved_at=setting.saved_at,
        )


class PresetOut(BaseModel):
    """A provider to start from: its name, base URL, and a model to ask."""

    name: str
    base_url: str
    model: str


class AiOut(BaseModel):
    """The provider, or `null` when it is not set up, the presets, and what is sent of a video."""

    provider: ProviderOut | None
    presets: list[PresetOut]
    max_description: int
    """The most characters of a video's description sent to the provider."""


@router.get("")
def get_ai(me: SignedInAccount, ai: AiDep) -> AiOut:
    """Return the provider, or null when none is set up; admins only."""
    setting = ai.get(me)
    return AiOut(
        provider=None if setting is None else ProviderOut.of(setting),
        presets=[
            PresetOut(name=each.name, base_url=each.base_url, model=each.model) for each in PRESETS
        ],
        max_description=MAX_DESCRIPTION,
    )


@router.put("")
def set_ai(body: AiIn, me: SignedInAccount, ai: AiDep) -> ProviderOut:
    """Set the provider; a setting that breaks a rule answers 422, never echoing the key."""
    key = None if body.key is None else body.key.get_secret_value()
    return ProviderOut.of(ai.save(me, body.base_url, body.model, key))


@router.delete("/key")
def remove_key(me: SignedInAccount, ai: AiDep) -> ProviderOut:
    """Forget the provider's key and keep its address and model; 404 when it is not set up."""
    return ProviderOut.of(ai.remove_key(me))


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def remove_ai(me: SignedInAccount, ai: AiDep) -> None:
    """Forget the provider and its key; 204 also when there is none."""
    ai.remove(me)
