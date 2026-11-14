"""The artist names API: the Library's artist names, looked up on MusicBrainz, and linked."""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, status
from pydantic import BaseModel, Field

from medleyplay.application.artists import MAX_LOOK_UP, ArtistName, KnownArtist
from medleyplay.domain.artists import LookUp
from medleyplay.web.deps import ArtistsDep, SignedInAccount

router = APIRouter(prefix="/api/artist-names", tags=["artists"])

type _Name = Annotated[str, Field(min_length=1, max_length=512)]


class AliasOut(BaseModel):
    """Another name an artist goes by."""

    name: str
    locale: str | None
    primary: bool


class ArtistOut(BaseModel):
    """An artist MusicBrainz knows, with every name it goes by."""

    id: str
    name: str
    sort_name: str
    disambiguation: str
    country: str
    aliases: list[AliasOut]

    @classmethod
    def of(cls, known: KnownArtist) -> "ArtistOut":
        """Return the API view of `known`."""
        artist = known.artist
        return cls(
            id=artist.id,
            name=artist.name,
            sort_name=artist.sort_name,
            disambiguation=artist.disambiguation,
            country=artist.country,
            aliases=[
                AliasOut(name=a.name, locale=a.locale, primary=a.primary) for a in known.aliases
            ],
        )


class CandidateOut(BaseModel):
    """An artist MusicBrainz knows by the name, and how well it said it matches."""

    artist_id: str
    score: int


class ArtistNameOut(BaseModel):
    """A name Tracks show as an artist or album artist, and what is known of it."""

    name: str
    key: str = Field(description="The name folded: names alike but for case or width are one.")
    tracks: int
    look_up: LookUp = Field(description="Whether it may be looked up, never, or once tidied.")
    linked: bool = Field(description="Whether the household chose an artist, or none, for it.")
    artist_id: str | None = Field(description="The artist chosen; none when it chose none.")
    looked_at: datetime | None
    candidates: list[CandidateOut] = Field(description="What MusicBrainz knows, best first.")
    suggested: str | None = Field(description="The artist going by the name exactly, if one.")
    finding: bool = Field(description="Whether MusicBrainz is being asked about it now.")

    @classmethod
    def of(cls, named: ArtistName) -> "ArtistNameOut":
        """Return the API view of `named`."""
        return cls(
            name=named.name,
            key=named.key,
            tracks=named.tracks,
            look_up=named.look_up,
            linked=named.linked,
            artist_id=named.artist_id,
            looked_at=named.looked_at,
            candidates=[CandidateOut(artist_id=i, score=s) for i, s in named.candidates],
            suggested=named.suggested,
            finding=named.finding,
        )


class ArtistNamesOut(BaseModel):
    """Every artist name the Library shows, most Tracks first, and the artists they name."""

    names: list[ArtistNameOut]
    artists: list[ArtistOut]


class LookUpIn(BaseModel):
    """Names to ask MusicBrainz about."""

    names: Annotated[list[_Name], Field(min_length=1, max_length=MAX_LOOK_UP)]


class LookUpOut(BaseModel):
    """How many of the names are being asked about."""

    asked: int


class LinkIn(BaseModel):
    """Link a name to an artist MusicBrainz named for it, or to none."""

    name: _Name
    artist_id: Annotated[str, Field(max_length=64)] | None


class UnlinkIn(BaseModel):
    """Forget the link of a name."""

    name: _Name


@router.get("")
def artist_names(_: SignedInAccount, service: ArtistsDep) -> ArtistNamesOut:
    """Return every artist name the Library shows, and what is known of each."""
    found = service.names()
    return ArtistNamesOut(
        names=[ArtistNameOut.of(each) for each in found.names],
        artists=[ArtistOut.of(each) for each in found.artists.values()],
    )


@router.post("/look-up")
def look_up(body: LookUpIn, me: SignedInAccount, service: ArtistsDep) -> LookUpOut:
    """Ask MusicBrainz about each name not linked yet, one a second."""
    return LookUpOut(asked=service.look_up(me, body.names))


@router.put("/link", status_code=status.HTTP_204_NO_CONTENT)
def link(body: LinkIn, _: SignedInAccount, service: ArtistsDep) -> None:
    """Link the name to the artist, or to none, in place of any link it had."""
    service.link(body.name, body.artist_id)


@router.post("/unlink", status_code=status.HTTP_204_NO_CONTENT)
def unlink(body: UnlinkIn, _: SignedInAccount, service: ArtistsDep) -> None:
    """Forget the name's link, so it is offered again."""
    service.unlink(body.name)
