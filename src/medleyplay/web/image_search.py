"""Signed-in picture discovery and admin-only Tavily key management."""

from typing import Annotated

from fastapi import APIRouter, Query, status
from pydantic import BaseModel, ConfigDict, Field, SecretStr

from medleyplay.application.image_search import SearchState
from medleyplay.domain.ai import MAX_KEY
from medleyplay.plugin_api import MAX_NAME
from medleyplay.web.deps import ImageSearchDep, SignedInAccount

router = APIRouter(prefix="/api/image-search", tags=["covers"])


class KeyIn(BaseModel):
    """The household's write-only Tavily key."""

    model_config = ConfigDict(extra="forbid")
    key: SecretStr = Field(max_length=MAX_KEY)


class SettingsOut(BaseModel):
    """Whether an admin has saved a key."""

    configured: bool


class SubjectIn(BaseModel):
    """An album and artist, or just the artist for a photo."""

    model_config = ConfigDict(extra="forbid")
    album: str = Field(default="", max_length=MAX_NAME)
    artist: str = Field(default="", max_length=MAX_NAME)


type _Name = Annotated[str, Query(max_length=MAX_NAME)]


@router.get("")
def settings(_: SignedInAccount, service: ImageSearchDep) -> SettingsOut:
    """Report whether the household has configured search without revealing the key."""
    return SettingsOut(configured=service.keys.configured())


@router.put("/key")
def set_key(body: KeyIn, me: SignedInAccount, service: ImageSearchDep) -> SettingsOut:
    """Save the provider key; admins only."""
    service.keys.set(me, body.key.get_secret_value())
    return SettingsOut(configured=True)


@router.delete("/key")
def remove_key(me: SignedInAccount, service: ImageSearchDep) -> SettingsOut:
    """Remove the provider key; admins only."""
    service.keys.remove(me)
    return SettingsOut(configured=False)


@router.get("/results")
def results(
    me: SignedInAccount, service: ImageSearchDep, album: _Name = "", artist: _Name = ""
) -> SearchState:
    """Return the latest results and any active Job without starting a search."""
    return service.results(me, album, artist)


@router.post("/results", status_code=status.HTTP_202_ACCEPTED)
def search(body: SubjectIn, me: SignedInAccount, service: ImageSearchDep) -> None:
    """Ask Tavily for source-linked images; this does not download any of them."""
    service.search(me, body.album, body.artist)
