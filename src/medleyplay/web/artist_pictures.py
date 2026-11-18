"""The artist pictures API: the pictures of an artist a site has, to choose its photo from.

Nothing here changes the artist's photo: the household uses a picture found as it
uses any cover already kept, through the artist's photo. An AI model may be asked which
picture is of the artist; its pick is only a suggestion.
"""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Path, status
from pydantic import BaseModel, Field

from medleyplay.application.artist_pictures import ArtistPictures, PicturePick
from medleyplay.plugin_api import MAX_HINT
from medleyplay.web.deps import ArtistPicturesDep, SignedInAccount

router = APIRouter(prefix="/api/artists", tags=["artists"])

type _ArtistId = Annotated[str, Path(max_length=64)]


class FoundPictureOut(BaseModel):
    """A picture of an artist the site knows by `name`, with `fans` following it."""

    name: str
    fans: int | None
    cover: str


class PicturePickOut(BaseModel):
    """The picture an AI model picked, why, which model answered, and the note it was asked with."""

    cover: str
    why: str
    model: str
    host: str
    at: datetime
    hint: str

    @staticmethod
    def of(pick: PicturePick) -> "PicturePickOut":
        """Return a pick as the API shows it."""
        return PicturePickOut(
            cover=pick.cover,
            why=pick.why,
            model=pick.model,
            host=pick.host,
            at=pick.at,
            hint=pick.hint,
        )


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
    pick: PicturePickOut | None = Field(
        description="The picture an AI model picked among those found, if one was asked."
    )
    choosing: bool
    choice_failure: str | None = Field(
        description="Why the last asking failed; only to the Account that asked, and to admins."
    )
    may_choose: bool = Field(description="Whether an AI model may be asked which picture fits.")

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
            pick=None if known.pick is None else PicturePickOut.of(known.pick),
            choosing=known.choosing,
            choice_failure=known.choice_failure,
            may_choose=known.may_choose,
        )


class ChooseIn(BaseModel):
    """What the listener says of which artist they mean, for the AI; empty for nothing."""

    hint: str = Field(default="", max_length=MAX_HINT, examples=["the band, not a tribute act"])


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


@router.post("/{artist_id}/pictures/choose", status_code=status.HTTP_202_ACCEPTED)
def choose(
    artist_id: _ArtistId, body: ChooseIn, me: SignedInAccount, service: ArtistPicturesDep
) -> None:
    """Ask an AI model which picture found is of the artist; nothing is changed."""
    service.choose(me, artist_id, body.hint)
