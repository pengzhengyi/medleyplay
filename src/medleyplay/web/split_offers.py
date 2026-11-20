"""The split offers API: long files a song list was found for, to split or keep as one file.

Splitting names each file with the offer the household saw, by its signature, so a file
whose list changed since is left as it is.
"""

from typing import Final

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, Field, TypeAdapter

from medleyplay.application.split_offers import Chosen, OfferedFile
from medleyplay.domain.catalog import TrackId
from medleyplay.domain.settings import SplitAlbums
from medleyplay.domain.split_offers import Doubt, OfferSource
from medleyplay.web.cached import NOT_MODIFIED
from medleyplay.web.deps import AnswersDep, SignedInAccount, SplitOffersDep

router = APIRouter(prefix="/api/split-offers", tags=["songs"])

MAX_CHOSEN = 500
"""The most files split or kept at once."""


class OfferedSongOut(BaseModel):
    """A song of the list offered: where it starts, its title, and maybe its artist."""

    start_ms: int
    title: str
    artist: str


class SplitOfferOut(BaseModel):
    """The list a file may be split by, who listed it, and what makes it doubtful."""

    source: OfferSource
    songs: list[OfferedSongOut]
    doubts: list[Doubt]
    trusted: bool = Field(description="Whether Auto splits the file by it.")
    signature: str = Field(description="The offer as shown; name it to split by it.")


class OfferedFileOut(BaseModel):
    """A long file shown as an album, not split yet, and the list offered for it, if any."""

    track_id: int
    title: str
    artist: str
    length_ms: int | None
    offer: SplitOfferOut | None
    has_text: bool = Field(description="Whether its video's text was read, so the AI may be asked.")

    @staticmethod
    def of(file: OfferedFile) -> "OfferedFileOut":
        """Return a file offered as the API shows it."""
        offer = file.offer
        return OfferedFileOut(
            track_id=file.track_id,
            title=file.title,
            artist=file.artist,
            length_ms=file.length_ms,
            offer=None
            if offer is None
            else SplitOfferOut(
                source=offer.source,
                songs=[
                    OfferedSongOut(start_ms=song.start_ms, title=song.title, artist=song.artist)
                    for song in offer.songs
                ],
                doubts=list(offer.doubts),
                trusted=offer.trusted,
                signature=offer.signature,
            ),
            has_text=file.has_text,
        )


class SplitOffersOut(BaseModel):
    """The household's setting, and the long files offered under it."""

    setting: SplitAlbums
    files: list[OfferedFileOut]


class ChosenIn(BaseModel):
    """A file to split, and the signature of the offer seen for it."""

    track_id: int = Field(ge=1)
    signature: str = Field(max_length=4096)


class SplitIn(BaseModel):
    """The files to split, each by the offer seen for it."""

    files: list[ChosenIn] = Field(min_length=1, max_length=MAX_CHOSEN)


class SplitOut(BaseModel):
    """How many files were split, and how many were left as they were."""

    split: int
    left: int


class KeepIn(BaseModel):
    """The files to keep as one, so no list is offered for them again."""

    track_ids: list[int] = Field(min_length=1, max_length=MAX_CHOSEN)


class KeptOut(BaseModel):
    """How many files are kept as one."""

    kept: int


SPLIT_OFFERS: Final = TypeAdapter(SplitOffersOut)


@router.get("", response_model=SplitOffersOut, responses=NOT_MODIFIED)
def offers(
    request: Request, _: SignedInAccount, service: SplitOffersDep, answers: AnswersDep
) -> Response:
    """Return the setting *Split albums*, and every long file to split or to keep.

    304 when the request holds the answer already.
    """

    def build() -> SplitOffersOut:
        found = service.offers()
        return SplitOffersOut(
            setting=found.setting, files=[OfferedFileOut.of(each) for each in found.files]
        )

    return answers.answer(request, ("split-offers",), build, SPLIT_OFFERS, heavy=False)


@router.post("/split")
def split(body: SplitIn, me: SignedInAccount, service: SplitOffersDep) -> SplitOut:
    """Split each file by the offer seen for it; one whose offer changed is left as it is."""
    done = service.split(
        me, [Chosen(TrackId(each.track_id), each.signature) for each in body.files]
    )
    return SplitOut(split=done.split, left=done.left)


@router.post("/keep")
def keep(body: KeepIn, me: SignedInAccount, service: SplitOffersDep) -> KeptOut:
    """Keep each file as one, so no list is offered for it again."""
    return KeptOut(kept=service.keep(me, [TrackId(each) for each in body.track_ids]))
