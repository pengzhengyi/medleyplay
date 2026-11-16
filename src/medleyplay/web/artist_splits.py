"""The artist splits API: names written as several artists, to split into each or keep.

Splitting a name binds every song showing it to each artist it lists; keeping it binds
them to the name as written. Either is remembered until forgotten.
"""

from fastapi import APIRouter, status
from pydantic import BaseModel, Field

from medleyplay.application.artist_splits import SplitDecision, SplitOffer
from medleyplay.domain.artist_split import Role
from medleyplay.web.deps import ArtistSplitsDep, SignedInAccount

router = APIRouter(prefix="/api/artist-splits", tags=["artists"])

MAX_NAMES = 500
"""The most names split, kept, or forgotten at once."""


class CreditOut(BaseModel):
    """One artist a name lists, as written, and how songs credit it."""

    written: str
    role: Role


class SplitOfferOut(BaseModel):
    """A name written as several artists, the artists it lists, and how many songs show it."""

    written: str
    artists: list[CreditOut]
    songs: int
    linked: bool = Field(description="Whether it is linked to one MusicBrainz artist.")

    @staticmethod
    def of(offer: SplitOffer) -> "SplitOfferOut":
        """Return an offer as the API shows it."""
        return SplitOfferOut(
            written=offer.written,
            artists=[CreditOut(written=each.written, role=each.role) for each in offer.credits],
            songs=offer.songs,
            linked=offer.linked,
        )


class DecisionOut(BaseModel):
    """A name the household split, or kept as written."""

    written: str
    split: bool

    @staticmethod
    def of(decision: SplitDecision) -> "DecisionOut":
        """Return a decision as the API shows it."""
        return DecisionOut(written=decision.written, split=decision.split)


class ArtistSplitsOut(BaseModel):
    """The names offered to split, and those decided."""

    offers: list[SplitOfferOut]
    decided: list[DecisionOut]


class NamesIn(BaseModel):
    """Artist names, as written."""

    names: list[str] = Field(min_length=1, max_length=MAX_NAMES)


@router.get("")
def splits(_: SignedInAccount, service: ArtistSplitsDep) -> ArtistSplitsOut:
    """Return every name offered to split, most songs first, and every name decided."""
    return ArtistSplitsOut(
        offers=[SplitOfferOut.of(each) for each in service.offers()],
        decided=[DecisionOut.of(each) for each in service.decided()],
    )


@router.post("/split", status_code=status.HTTP_204_NO_CONTENT)
def split(body: NamesIn, _: SignedInAccount, service: ArtistSplitsDep) -> None:
    """Split each name into the artists it lists."""
    service.split(body.names)


@router.post("/keep", status_code=status.HTTP_204_NO_CONTENT)
def keep(body: NamesIn, _: SignedInAccount, service: ArtistSplitsDep) -> None:
    """Keep each name as written, as one artist."""
    service.keep(body.names)


@router.post("/forget", status_code=status.HTTP_204_NO_CONTENT)
def forget(body: NamesIn, _: SignedInAccount, service: ArtistSplitsDep) -> None:
    """Forget what was decided for each name, so it is offered again."""
    service.forget(body.names)
