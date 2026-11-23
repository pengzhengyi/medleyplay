"""Signed-in picture discovery and admin-only Tavily key management."""

from typing import Annotated

from fastapi import APIRouter, Path, Query, status
from pydantic import BaseModel, ConfigDict, Field, SecretStr

from medleyplay.application.image_links import AlbumPictured, ArtistPictured
from medleyplay.application.image_search import SearchState
from medleyplay.domain.ai import MAX_KEY
from medleyplay.domain.errors import KeychainUnavailableError
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


class ArtistSettingsOut(SettingsOut):
    """The artist's profile name and whether a Tavily key can be read."""

    name: str


class SubjectIn(BaseModel):
    """An album and artist, or just the artist for a photo."""

    model_config = ConfigDict(extra="forbid")
    album: str = Field(default="", max_length=MAX_NAME)
    artist: str = Field(default="", max_length=MAX_NAME)


type _Name = Annotated[str, Query(max_length=MAX_NAME)]
type _ArtistId = Annotated[str, Path(max_length=64)]


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
    return service.results(me, AlbumPictured(album, artist))


@router.post("/results", status_code=status.HTTP_202_ACCEPTED)
def search(body: SubjectIn, me: SignedInAccount, service: ImageSearchDep) -> None:
    """Ask Tavily for source-linked images; this does not download any of them."""
    service.search(me, AlbumPictured(body.album, body.artist))


@router.get("/artist/{artist_id}")
def artist_settings(
    artist_id: _ArtistId, _: SignedInAccount, service: ImageSearchDep
) -> ArtistSettingsOut:
    """Return the only artist name used for web search, without starting a search."""
    name = service.artist_name(artist_id)
    try:
        configured = service.keys.configured()
    except KeychainUnavailableError:
        configured = False
    return ArtistSettingsOut(name=name, configured=configured)


@router.get("/artist/{artist_id}/results")
def artist_results(
    artist_id: _ArtistId, me: SignedInAccount, service: ImageSearchDep
) -> SearchState:
    """Return this profile's latest results and any active Job."""
    return service.results(me, ArtistPictured(artist_id))


@router.post("/artist/{artist_id}/results", status_code=status.HTTP_202_ACCEPTED)
def search_for_artist(artist_id: _ArtistId, me: SignedInAccount, service: ImageSearchDep) -> None:
    """Ask Tavily for source-linked photos using the artist's profile name."""
    service.search(me, ArtistPictured(artist_id))
