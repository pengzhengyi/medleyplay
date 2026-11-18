"""The artists API: the Library's artist names, and what the household chooses for an artist.

Names are looked up on MusicBrainz and linked; for an artist, the household may
choose the name it is shown by, a note, and a photo.
"""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Request, status
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from medleyplay.application.artists import MAX_LOOK_UP, ArtistName, KnownArtist
from medleyplay.domain.artists import MAX_ABOUT, MAX_SHOWN_AS, LookUp
from medleyplay.domain.covers import MAX_COVER_BYTES
from medleyplay.web.deps import ArtistsDep, SignedInAccount

router = APIRouter(prefix="/api/artist-names", tags=["artists"])
artists_router = APIRouter(prefix="/api/artists", tags=["artists"])

type _Name = Annotated[str, Field(min_length=1, max_length=512)]
type _ArtistId = Annotated[str, Path(max_length=64)]


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
    page: str | None = Field(description="Its page on Wikidata, once Wikidata gives it.")
    photo: str | None = Field(description="The cover holding its photo, from Wikidata.")
    photo_page: str | None = Field(
        description="Where Wikidata's photo comes from, and its license; none for the household's."
    )
    shown_as: str | None = Field(description="The name the household shows it by, if chosen.")
    about: str | None = Field(description="The household's note about it, if any.")
    own_photo: bool = Field(description="Whether the photo is the household's own.")

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
            page=known.page,
            photo=known.photo,
            photo_page=known.photo_page,
            shown_as=known.shown_as,
            about=known.about,
            own_photo=known.own_photo,
        )


class CandidateOut(BaseModel):
    """An artist MusicBrainz knows by the name, and how well it said it matches."""

    artist_id: str
    score: int


class RecommendationOut(BaseModel):
    """The artist an AI model recommends linking a name to, or none, and why."""

    artist_id: str | None = Field(description="The artist recommended; none for none offered.")
    why: str
    model: str = Field(description="The model that answered, as it was then.")
    host: str = Field(description="Where the model was asked.")
    at: datetime


class ArtistSuggestionOut(BaseModel):
    """What an AI model suggests for an artist: a name to show it by, and a note."""

    shown_as: str | None = Field(description="One of the names it goes by; none for none.")
    why: str = Field(description="Why that name; empty with none.")
    about: str = Field(description="A note about who it is; empty for none.")
    model: str = Field(description="The model that answered, as it was then.")
    host: str = Field(description="Where the model was asked.")
    at: datetime


class SuggestionOut(BaseModel):
    """Whether an AI model is asked about an artist now, what it last suggested, and why not."""

    asking: bool
    waiting: bool = Field(description="Whether the asking waits for medleyplay to be Online.")
    suggestion: ArtistSuggestionOut | None
    failure: str | None = Field(
        description="Why the last asking failed; only to the Account that asked, and to admins."
    )


class ArtistNameOut(BaseModel):
    """A name Tracks show as an artist or album artist, and what is known of it."""

    name: str
    key: str = Field(description="The name folded: names alike but for case or width are one.")
    tracks: int
    look_up: LookUp = Field(description="Whether it may be looked up, never, or once tidied.")
    linked: bool = Field(description="Whether the household chose an artist, or none, for it.")
    artist_id: str | None = Field(description="The artist chosen; none when it chose none.")
    looked_at: datetime | None
    candidates: list[CandidateOut] = Field(
        description="What MusicBrainz knows, and artists linked that go by the name; best first."
    )
    suggested: str | None = Field(description="The artist going by the name exactly, if one.")
    finding: bool = Field(
        description="Whether MusicBrainz is asked about it now, or Wikidata about its artist."
    )
    recommendation: RecommendationOut | None = Field(
        default=None, description="What an AI model last recommended, while it isn't linked."
    )
    artist_ids: list[str] = Field(
        default_factory=list,
        description="The Library's artists the name names, its first first; several share it.",
    )

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
            artist_ids=list(named.artist_ids),
            recommendation=None
            if named.recommendation is None
            else RecommendationOut(
                artist_id=named.recommendation.artist_id,
                why=named.recommendation.why,
                model=named.recommendation.model,
                host=named.recommendation.host,
                at=named.recommendation.at,
            ),
        )


class ArtistNamesOut(BaseModel):
    """Every artist name the Library shows, most Tracks first, and the artists they name."""

    names: list[ArtistNameOut]
    artists: list[ArtistOut]
    recommending: bool = Field(
        default=False, description="Whether an AI model is being asked which artists they name."
    )


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


class ArtistDetailsIn(BaseModel):
    """What the household chooses for an artist; an empty one, or none, is forgotten."""

    shown_as: Annotated[str, Field(max_length=MAX_SHOWN_AS)] | None = None
    about: Annotated[str, Field(max_length=MAX_ABOUT)] | None = None


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
        recommending=service.recommending(),
    )


@router.post("/look-up")
def look_up(body: LookUpIn, me: SignedInAccount, service: ArtistsDep) -> LookUpOut:
    """Ask MusicBrainz about each name not linked yet, one a second."""
    return LookUpOut(asked=service.look_up(me, body.names))


@router.post("/recommend")
def recommend(me: SignedInAccount, service: ArtistsDep) -> LookUpOut:
    """Ask an AI model which artist each name looked up and not linked names.

    What it answers is kept as each name's recommendation; nothing is linked.
    """
    return LookUpOut(asked=service.recommend(me))


@router.put("/link", status_code=status.HTTP_204_NO_CONTENT)
def link(body: LinkIn, me: SignedInAccount, service: ArtistsDep) -> None:
    """Link the name to the artist, or to none, in place of any link it had.

    Wikidata is then asked every other name the artist goes by.
    """
    service.link(me, body.name, body.artist_id)


@router.post("/unlink", status_code=status.HTTP_204_NO_CONTENT)
def unlink(body: UnlinkIn, _: SignedInAccount, service: ArtistsDep) -> None:
    """Forget the name's link, so it is offered again."""
    service.unlink(body.name)


@artists_router.put("/{artist_id}/details", status_code=status.HTTP_204_NO_CONTENT)
def set_details(
    artist_id: _ArtistId, body: ArtistDetailsIn, _: SignedInAccount, service: ArtistsDep
) -> None:
    """Keep the name the artist is shown by, and a note about it; its songs keep theirs."""
    service.set_details(artist_id, shown_as=body.shown_as, about=body.about)


@artists_router.get("/{artist_id}/suggestion")
def suggestion(artist_id: _ArtistId, me: SignedInAccount, service: ArtistsDep) -> SuggestionOut:
    """Return whether an AI model is asked about the artist, and what it last suggested."""
    state = service.suggestion(me, artist_id)
    found = state.suggestion
    return SuggestionOut(
        asking=state.asking,
        waiting=state.waiting,
        suggestion=None
        if found is None
        else ArtistSuggestionOut(
            shown_as=found.shown_as,
            why=found.why,
            about=found.about,
            model=found.model,
            host=found.host,
            at=found.at,
        ),
        failure=state.failure,
    )


@artists_router.post("/{artist_id}/suggestion", status_code=status.HTTP_202_ACCEPTED)
def suggest(artist_id: _ArtistId, me: SignedInAccount, service: ArtistsDep) -> None:
    """Ask an AI model which name to show the artist by, and who it is; nothing is changed."""
    service.suggest(me, artist_id)


@artists_router.put(
    "/{artist_id}/photo",
    status_code=status.HTTP_204_NO_CONTENT,
    openapi_extra={
        "requestBody": {"content": {"image/*": {"schema": {"type": "string", "format": "binary"}}}}
    },
)
async def set_photo(
    artist_id: _ArtistId, request: Request, _: SignedInAccount, service: ArtistsDep
) -> None:
    """Make the image in the body the household's photo of the artist."""
    data = bytearray()
    async for chunk in request.stream():
        data += chunk
        if len(data) > MAX_COVER_BYTES:
            message = f"A photo is at most {MAX_COVER_BYTES // (1024 * 1024)} MiB."
            raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, message)
    # Hashing, writing, and waiting on the database go to a thread, clear of the event loop.
    await run_in_threadpool(service.set_photo, artist_id, bytes(data))


class PhotoCoverIn(BaseModel):
    """A cover already kept, such as an image fetched from a link a model suggested."""

    cover: str = Field(min_length=64, max_length=64)


@artists_router.post("/{artist_id}/photo/cover", status_code=status.HTTP_204_NO_CONTENT)
def use_photo(
    artist_id: _ArtistId, body: PhotoCoverIn, _: SignedInAccount, service: ArtistsDep
) -> None:
    """Make a cover already kept the household's photo of the artist."""
    service.use_photo(artist_id, body.cover)


@artists_router.delete("/{artist_id}/photo", status_code=status.HTTP_204_NO_CONTENT)
def remove_photo(artist_id: _ArtistId, _: SignedInAccount, service: ArtistsDep) -> None:
    """Drop the household's photo of the artist, so Wikidata's shows again."""
    service.remove_photo(artist_id)
