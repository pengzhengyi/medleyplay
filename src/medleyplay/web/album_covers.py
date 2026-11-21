"""The album covers API: finding the covers of an album's releases, and an AI model's pick.

Nothing here changes a cover: the household sets the one it chooses on the album's
songs, as any detail is set.
"""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Query, status
from pydantic import BaseModel, Field

from medleyplay.application.album_covers import AlbumCovers
from medleyplay.plugin_api import MAX_NAME, CoverOption
from medleyplay.web.deps import AlbumCoversDep, SignedInAccount

router = APIRouter(prefix="/api/album-covers", tags=["covers"])

type _Album = Annotated[str, Query(min_length=1, max_length=MAX_NAME)]
type _Artist = Annotated[str, Query(max_length=MAX_NAME)]


class AlbumIn(BaseModel):
    """An album by its name and artist, its album artist or else its artist, as written."""

    album: str = Field(min_length=1, max_length=MAX_NAME)
    artist: str = Field(default="", max_length=MAX_NAME)


class FoundCoverOut(BaseModel):
    """A release of the album, and the cover holding its front cover."""

    release: CoverOption
    cover: str


class CoverPickOut(BaseModel):
    """The release an AI model picked of those found, why, and the model that answered."""

    release_id: str
    why: str
    model: str
    host: str
    at: datetime


class AlbumCoversOut(BaseModel):
    """What is known of an album's covers, and what is being asked."""

    covers: list[FoundCoverOut] = Field(description="Those last found, best first.")
    found_at: datetime | None
    pick: CoverPickOut | None = Field(description="An AI model's pick among the covers found.")
    finding: bool
    choosing: bool
    waiting: bool = Field(description="Whether the asking waits for medleyplay to be Online.")
    failure: str | None = Field(
        description="Why the last finding failed; only to the Account that asked, and to admins."
    )
    choice_failure: str | None = Field(description="Why the last asking of an AI model failed.")
    may_choose: bool = Field(
        description="Whether an AI model may be asked to pick: one is set up, and none picked."
    )
    suggested: str | None = Field(
        description=(
            "The cover suggested as the album's: the AI's pick, else the best-ranked release"
            " whose title and artist are the album's; none dismissed, and none when none match."
        )
    )
    due: bool = Field(
        description="Whether the album may be searched on its own: never, or in vain long ago."
    )
    may_find: bool = Field(description="Whether the MusicBrainz plugin is on to be asked.")

    @staticmethod
    def of(known: AlbumCovers) -> "AlbumCoversOut":
        """Return what is known of an album's covers as the API shows it."""
        pick = known.pick
        return AlbumCoversOut(
            covers=[FoundCoverOut(release=each.option, cover=each.cover) for each in known.covers],
            found_at=known.found_at,
            pick=None
            if pick is None
            else CoverPickOut(
                release_id=pick.release_id,
                why=pick.why,
                model=pick.model,
                host=pick.host,
                at=pick.at,
            ),
            finding=known.finding,
            choosing=known.choosing,
            waiting=known.waiting,
            failure=known.failure,
            choice_failure=known.choice_failure,
            may_choose=known.may_choose,
            suggested=known.suggested,
            due=known.due,
            may_find=known.may_find,
        )


@router.get("")
def covers(
    album: _Album, me: SignedInAccount, service: AlbumCoversDep, artist: _Artist = ""
) -> AlbumCoversOut:
    """Return what is known of the album's covers, and what is being asked."""
    return AlbumCoversOut.of(service.covers(me, album, artist))


@router.post("/find", status_code=status.HTTP_202_ACCEPTED)
def find(body: AlbumIn, me: SignedInAccount, service: AlbumCoversDep) -> None:
    """Ask MusicBrainz for the covers of the album's releases; nothing is changed."""
    service.find(me, body.album, body.artist)


@router.post("/choose", status_code=status.HTTP_202_ACCEPTED)
def choose(body: AlbumIn, me: SignedInAccount, service: AlbumCoversDep) -> None:
    """Ask an AI model which of the releases found is the album; nothing is changed."""
    service.choose(me, body.album, body.artist)


class DismissIn(AlbumIn):
    """A cover found for the album that is not its cover."""

    cover: str = Field(max_length=128)


@router.post("/dismiss", status_code=status.HTTP_204_NO_CONTENT)
def dismiss(body: DismissIn, me: SignedInAccount, service: AlbumCoversDep) -> None:
    """Suggest the cover found no more as the album's; nothing else is changed."""
    service.dismiss(me, body.album, body.artist, body.cover)
