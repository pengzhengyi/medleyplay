"""The image links API: links to pictures an AI model suggests, and fetching the one approved.

Nothing here changes a cover or a photo: the image fetched is kept as a cover, which the
household then sets on the album's songs as any detail is set, or makes the artist's
photo.
"""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Path, Query, status
from pydantic import BaseModel, Field

from medleyplay.application.image_links import (
    AlbumPictured,
    ArtistPictured,
    PictureLinks,
    SuggestedLink,
)
from medleyplay.plugin_api import MAX_LINK, MAX_NAME
from medleyplay.web.deps import ImageLinksDep, SignedInAccount

router = APIRouter(prefix="/api/image-links", tags=["covers"])

type _Album = Annotated[str, Query(min_length=1, max_length=MAX_NAME)]
type _Artist = Annotated[str, Query(max_length=MAX_NAME)]
type _ArtistId = Annotated[str, Path(max_length=64)]


class AlbumIn(BaseModel):
    """An album by its name and artist, its album artist or else its artist, as written."""

    album: str = Field(min_length=1, max_length=MAX_NAME)
    artist: str = Field(default="", max_length=MAX_NAME)


class ApproveIn(BaseModel):
    """A link the model suggested, approved to fetch."""

    url: str = Field(min_length=1, max_length=MAX_LINK)


class AlbumApproveIn(AlbumIn, ApproveIn):
    """A link the model suggested for the album's cover, approved to fetch."""


class ApprovedOut(BaseModel):
    """The cover holding the image, when it was fetched before; else it is being fetched."""

    cover: str | None


class SuggestedLinkOut(BaseModel):
    """A link suggested, the page showing it, why, and what fetching it gave."""

    url: str
    page: str | None
    why: str
    cover: str | None = Field(description="The cover holding the image, once fetched.")
    unavailable: str = Field(description="Why there is no image at the link, once asked.")
    fetching: bool
    failure: str | None = Field(
        description="Why the last fetching failed; only to the Account that asked, and to admins."
    )

    @staticmethod
    def of(link: SuggestedLink) -> "SuggestedLinkOut":
        """Return a link as the API shows it."""
        return SuggestedLinkOut(
            url=link.url,
            page=link.page,
            why=link.why,
            cover=link.cover,
            unavailable=link.unavailable,
            fetching=link.fetching,
            failure=link.failure,
        )


class PictureLinksOut(BaseModel):
    """The links a model last suggested for a picture, and what is being asked."""

    links: list[SuggestedLinkOut] = Field(description="Best first.")
    model: str
    host: str
    asked_at: datetime | None
    asking: bool
    waiting: bool = Field(description="Whether the asking waits for medleyplay to be Online.")
    failure: str | None = Field(description="Why the last asking failed.")
    may_suggest: bool = Field(description="Whether an AI model may be asked: one is set up.")

    @staticmethod
    def of(known: PictureLinks) -> "PictureLinksOut":
        """Return the links as the API shows them."""
        return PictureLinksOut(
            links=[SuggestedLinkOut.of(link) for link in known.links],
            model=known.model,
            host=known.host,
            asked_at=known.asked_at,
            asking=known.asking,
            waiting=known.waiting,
            failure=known.failure,
            may_suggest=known.may_suggest,
        )


@router.get("/album")
def album_links(
    album: _Album, me: SignedInAccount, service: ImageLinksDep, artist: _Artist = ""
) -> PictureLinksOut:
    """Return the links last suggested for the album's cover."""
    return PictureLinksOut.of(service.links(me, AlbumPictured(album, artist)))


@router.post("/album/suggest", status_code=status.HTTP_202_ACCEPTED)
def suggest_for_album(body: AlbumIn, me: SignedInAccount, service: ImageLinksDep) -> None:
    """Ask an AI model for links to the album's cover; nothing is fetched."""
    service.suggest(me, AlbumPictured(body.album, body.artist))


@router.post("/album/approve", status_code=status.HTTP_202_ACCEPTED)
def approve_for_album(
    body: AlbumApproveIn, me: SignedInAccount, service: ImageLinksDep
) -> ApprovedOut:
    """Fetch the image at a link suggested for the album's cover, keeping it as a cover."""
    return ApprovedOut(cover=service.approve(me, AlbumPictured(body.album, body.artist), body.url))


@router.get("/artist/{artist_id}")
def artist_links(
    artist_id: _ArtistId, me: SignedInAccount, service: ImageLinksDep
) -> PictureLinksOut:
    """Return the links last suggested for a photo of the artist."""
    return PictureLinksOut.of(service.links(me, ArtistPictured(artist_id)))


@router.post("/artist/{artist_id}/suggest", status_code=status.HTTP_202_ACCEPTED)
def suggest_for_artist(artist_id: _ArtistId, me: SignedInAccount, service: ImageLinksDep) -> None:
    """Ask an AI model for links to a photo of the artist; nothing is fetched."""
    service.suggest(me, ArtistPictured(artist_id))


@router.post("/artist/{artist_id}/approve", status_code=status.HTTP_202_ACCEPTED)
def approve_for_artist(
    artist_id: _ArtistId, body: ApproveIn, me: SignedInAccount, service: ImageLinksDep
) -> ApprovedOut:
    """Fetch the image at a link suggested for a photo of the artist, keeping it as a cover."""
    return ApprovedOut(cover=service.approve(me, ArtistPictured(artist_id), body.url))
