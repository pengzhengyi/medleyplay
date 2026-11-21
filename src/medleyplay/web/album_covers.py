"""The album covers API: finding the covers of an album's releases, and an AI model's pick.

The albums with no cover are listed with the cover suggested for each, and *use* makes
covers found their albums' at once; otherwise the household sets the one it chooses on
the album's songs, as any detail is set.
"""

from datetime import datetime
from typing import Annotated, Final

from fastapi import APIRouter, Query, Request, Response, status
from pydantic import BaseModel, Field, TypeAdapter

from medleyplay.application.album_covers import (
    MAX_COMING,
    MAX_USED,
    AlbumCovers,
    ChosenAlbumCover,
    MissingCover,
)
from medleyplay.plugin_api import MAX_NAME, CoverOption
from medleyplay.web.cached import NOT_MODIFIED
from medleyplay.web.deps import AlbumCoversDep, AnswersDep, SignedInAccount

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


class MissingCoverOut(BaseModel):
    """An album with no cover, as written, how many songs it has, and the cover suggested."""

    album: str
    artist: str
    songs: int
    suggested: str | None = Field(description="The cover suggested, as on the album's page.")
    picked: bool = Field(description="Whether an AI model picked the suggestion.")
    found: bool = Field(description="Whether MusicBrainz was searched for the album.")
    finding: bool = Field(description="Whether MusicBrainz is searched for it now.")

    @staticmethod
    def of(missing: MissingCover) -> "MissingCoverOut":
        """Return an album with no cover as the API shows it."""
        return MissingCoverOut(
            album=missing.album,
            artist=missing.artist,
            songs=missing.songs,
            suggested=missing.suggested,
            picked=missing.picked,
            found=missing.found,
            finding=missing.finding,
        )


class MissingCoversOut(BaseModel):
    """Every album with no cover, those with a cover suggested first, then most songs."""

    albums: list[MissingCoverOut]


MISSING_COVERS: Final = TypeAdapter(MissingCoversOut)


@router.get("/missing", response_model=MissingCoversOut, responses=NOT_MODIFIED)
def missing_covers(
    request: Request, _: SignedInAccount, service: AlbumCoversDep, answers: AnswersDep
) -> Response:
    """Return every album with no cover, and the cover suggested; 304 when unchanged."""
    return answers.answer(
        request,
        ("album-covers-missing",),
        lambda: MissingCoversOut(albums=[MissingCoverOut.of(each) for each in service.missing()]),
        MISSING_COVERS,
        heavy=True,
    )


class ComingIn(BaseModel):
    """The songs coming up, the one playing first, in the order they play."""

    track_ids: list[int] = Field(max_length=MAX_COMING)


class SearchedOut(BaseModel):
    """How many albums MusicBrainz is searched for."""

    asked: int


@router.post("/missing/find")
def find_missing(body: ComingIn, me: SignedInAccount, service: AlbumCoversDep) -> SearchedOut:
    """Search the albums with no cover of the songs playing and next, as the household chose.

    The rest of the songs coming up say which albums the background searches first.
    """
    return SearchedOut(asked=service.find_missing(me, body.track_ids))


class UsedIn(BaseModel):
    """The covers found to make their albums' covers."""

    albums: list[DismissIn] = Field(min_length=1, max_length=MAX_USED)


class UsedOut(BaseModel):
    """How many albums now show the cover chosen; one that gained a cover meanwhile doesn't."""

    used: int


@router.post("/use")
def use(body: UsedIn, me: SignedInAccount, service: AlbumCoversDep) -> UsedOut:
    """Make each cover found its album's, on its songs with none or its one file."""
    chosen = [ChosenAlbumCover(each.album, each.artist, each.cover) for each in body.albums]
    return UsedOut(used=service.use(me, chosen))
