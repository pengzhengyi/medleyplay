"""The artist pictures API: the pictures of an artist a site has, to choose its photo from.

Nothing here changes the artist's photo: the household uses a picture found as it
uses any cover already kept, through the artist's photo.
"""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Path, status
from pydantic import BaseModel, Field

from medleyplay.application.artist_pictures import ArtistPictures
from medleyplay.web.deps import ArtistPicturesDep, SignedInAccount

router = APIRouter(prefix="/api/artists", tags=["artists"])

type _ArtistId = Annotated[str, Path(max_length=64)]


class FoundPictureOut(BaseModel):
    """A picture of an artist the site knows by `name`, with `fans` following it."""

    name: str
    fans: int | None
    cover: str


class ArtistPicturesOut(BaseModel):
    """What is known of the pictures of an artist, and what is being asked."""

    pictures: list[FoundPictureOut] = Field(description="Those last found, most followed first.")
    found_at: datetime | None
    finding: bool
    waiting: bool = Field(description="Whether the asking waits for medleyplay to be Online.")
    failure: str | None = Field(
        description="Why the last finding failed; only to the Account that asked, and to admins."
    )
    may_find: bool = Field(description="Whether the household turned the site on in Settings.")

    @staticmethod
    def of(known: ArtistPictures) -> "ArtistPicturesOut":
        """Return what is known of an artist's pictures as the API shows it."""
        return ArtistPicturesOut(
            pictures=[
                FoundPictureOut(name=each.name, fans=each.fans, cover=each.cover)
                for each in known.pictures
            ],
            found_at=known.found_at,
            finding=known.finding,
            waiting=known.waiting,
            failure=known.failure,
            may_find=known.may_find,
        )


@router.get("/{artist_id}/pictures")
def pictures(
    artist_id: _ArtistId, me: SignedInAccount, service: ArtistPicturesDep
) -> ArtistPicturesOut:
    """Return what is known of the pictures of the artist, and what is being asked."""
    return ArtistPicturesOut.of(service.pictures(me, artist_id))


@router.post("/{artist_id}/pictures/find", status_code=status.HTTP_202_ACCEPTED)
def find(artist_id: _ArtistId, me: SignedInAccount, service: ArtistPicturesDep) -> None:
    """Ask Deezer for pictures of the artists going by the artist's name; nothing is changed."""
    service.find(me, artist_id)
