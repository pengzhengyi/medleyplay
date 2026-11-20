"""The artist pictures API: the pictures of an artist a site has, to choose its photo from.

Nothing here changes the artist's photo: the household uses a picture found as it
uses any cover already kept, through the artist's photo. An AI model may be asked which
picture is of the artist; its pick is only a suggestion, and a suggestion the household
dismisses is not made again.
"""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Path, status
from pydantic import BaseModel, Field

from medleyplay.application.artist_pictures import (
    MAX_FIND_TRACKS,
    ArtistPictures,
    MissingPhoto,
    PicturePick,
)
from medleyplay.plugin_api import MAX_HINT
from medleyplay.web.cached import heavy_read
from medleyplay.web.deps import ArtistPicturesDep, SignedInAccount

router = APIRouter(prefix="/api/artists", tags=["artists"])
photos_router = APIRouter(prefix="/api/artist-photos", tags=["artists"])

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
    suggested: str | None = Field(
        description=(
            "The cover suggested as the artist's photo: the AI's pick, else the most followed"
            " whose artist goes by one of the artist's names; none when no picture does."
        )
    )
    auto_pick: bool = Field(
        description="Whether the household has an AI model asked as soon as pictures are found."
    )

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
            suggested=known.suggested,
            auto_pick=known.auto_pick,
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


class DismissIn(BaseModel):
    """The picture found that is not of the artist."""

    cover: str = Field(max_length=128)


@router.post("/{artist_id}/pictures/dismiss", status_code=status.HTTP_204_NO_CONTENT)
def dismiss(
    artist_id: _ArtistId, body: DismissIn, me: SignedInAccount, service: ArtistPicturesDep
) -> None:
    """Suggest the picture no more as the artist's photo; nothing else is changed."""
    service.dismiss(me, artist_id, body.cover)


class MissingPhotoOut(BaseModel):
    """An artist linked to MusicBrainz with no photo, and the photo suggested for it."""

    artist_id: str
    name: str
    songs: int
    suggested: str | None = Field(description="The cover suggested as its photo, if any.")
    picked: bool = Field(description="Whether an AI model picked the one suggested.")
    found: bool = Field(description="Whether Deezer was asked about it.")
    finding: bool

    @staticmethod
    def of(missing: MissingPhoto) -> "MissingPhotoOut":
        """Return an artist with no photo as the API shows it."""
        return MissingPhotoOut(
            artist_id=missing.artist_id,
            name=missing.name,
            songs=missing.songs,
            suggested=missing.suggested,
            picked=missing.picked,
            found=missing.found,
            finding=missing.finding,
        )


class MissingPhotosOut(BaseModel):
    """Every artist linked to MusicBrainz with no photo, those with a photo suggested first."""

    artists: list[MissingPhotoOut]


class FindPhotosIn(BaseModel):
    """The songs whose artists with no photo to look up, or `null` for every such artist."""

    track_ids: list[int] | None = Field(default=None, max_length=MAX_FIND_TRACKS)


class FoundPhotosOut(BaseModel):
    """How many artists Deezer is asked about."""

    asked: int


@photos_router.get("/missing")
def missing_photos(_: SignedInAccount, service: ArtistPicturesDep) -> MissingPhotosOut:
    """Return every artist linked to MusicBrainz with no photo, and the photo suggested."""
    with heavy_read():
        missing = service.missing()
    return MissingPhotosOut(artists=[MissingPhotoOut.of(each) for each in missing])


@photos_router.post("/find")
def find_photos(
    body: FindPhotosIn, me: SignedInAccount, service: ArtistPicturesDep
) -> FoundPhotosOut:
    """Ask Deezer about the artists with no photo never looked up, as the household chose.

    The songs up next ask about their artists while the household has those looked up;
    `null` asks about every one while it has every one looked up; otherwise, or while
    Deezer is off, nothing is asked.
    """
    return FoundPhotosOut(asked=service.find_missing(me, body.track_ids))
