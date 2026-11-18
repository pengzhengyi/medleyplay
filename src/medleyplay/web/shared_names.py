"""The shared names API: names that may name several artists, told apart by album or kept as one.

Telling a name apart binds each album's songs to the artist chosen for them, which
confirms them; keeping a name as one stops it waiting until forgotten.
"""

from typing import Annotated

from fastapi import APIRouter, status
from pydantic import BaseModel, Field, model_validator

from medleyplay.application.shared_names import SharedName
from medleyplay.application.track_artists import SongsBy
from medleyplay.domain.catalog import TrackId
from medleyplay.web.deps import SharedNamesDep, SignedInAccount

router = APIRouter(prefix="/api/shared-names", tags=["artists"])

MAX_NAMES = 500
"""The most names kept or forgotten at once."""
MAX_ALBUMS = 500
"""The most albums of a name told apart at once."""
MAX_SONGS = 5000
"""The most songs of one album told apart at once."""

type _Name = Annotated[str, Field(min_length=1, max_length=512)]


class ArtistOfNameOut(BaseModel):
    """One of the Library's artists a name names, and how many of the name's songs are by it."""

    artist_id: str
    musicbrainz_id: str | None
    songs: int


class AlbumSongsOut(BaseModel):
    """The songs of one album writing a name that are by one artist."""

    album: str = Field(description="As most of its songs write it; empty for songs on none.")
    track_ids: list[int]
    artist_id: str
    confirmed: bool = Field(description="Whether the household chose the artist of every one.")


class SharedNameOut(BaseModel):
    """A name that may name several artists, and its songs by album."""

    name: str
    artists: list[ArtistOfNameOut]
    known: list[str] = Field(
        description="The MusicBrainz artists going by the name exactly, scored high, best first."
    )
    kept: bool
    waiting: bool
    albums: list[AlbumSongsOut]

    @staticmethod
    def of(named: SharedName) -> "SharedNameOut":
        """Return a name as the API shows it."""
        return SharedNameOut(
            name=named.name,
            artists=[
                ArtistOfNameOut(
                    artist_id=each.artist_id, musicbrainz_id=each.musicbrainz_id, songs=each.songs
                )
                for each in named.artists
            ],
            known=list(named.known),
            kept=named.kept,
            waiting=named.waiting,
            albums=[
                AlbumSongsOut(
                    album=each.album,
                    track_ids=list(each.track_ids),
                    artist_id=each.artist_id,
                    confirmed=each.confirmed,
                )
                for each in named.albums
            ],
        )


class SharedNamesOut(BaseModel):
    """Every name that may name several artists, most songs first."""

    names: list[SharedNameOut]


class SongsByIn(BaseModel):
    """Songs of a name, and the artist they are by: the Library's, or one MusicBrainz knows."""

    track_ids: list[int] = Field(min_length=1, max_length=MAX_SONGS)
    artist_id: str | None = Field(default=None, pattern=r"^[0-9a-f]{32}$")
    musicbrainz_id: str | None = Field(default=None, max_length=64)

    @model_validator(mode="after")
    def _one_artist(self) -> "SongsByIn":
        if (self.artist_id is None) == (self.musicbrainz_id is None):
            message = "Give one of artist_id and musicbrainz_id."
            raise ValueError(message)
        return self


class TellApartIn(BaseModel):
    """A name, and the artist each album of its songs is by."""

    name: _Name
    albums: list[SongsByIn] = Field(min_length=1, max_length=MAX_ALBUMS)


class NamesIn(BaseModel):
    """Artist names, as written."""

    names: list[_Name] = Field(min_length=1, max_length=MAX_NAMES)


@router.get("")
def shared_names(_: SignedInAccount, service: SharedNamesDep) -> SharedNamesOut:
    """Return every name that may name several artists, most songs first."""
    return SharedNamesOut(names=[SharedNameOut.of(each) for each in service.names()])


@router.put("/albums", status_code=status.HTTP_204_NO_CONTENT)
def tell_apart(body: TellApartIn, _: SignedInAccount, service: SharedNamesDep) -> None:
    """Bind each album's songs to the artist chosen for them, confirming them."""
    service.assign(
        body.name,
        [
            SongsBy(
                tuple(TrackId(each) for each in album.track_ids),
                artist_id=album.artist_id,
                musicbrainz_id=album.musicbrainz_id,
            )
            for album in body.albums
        ],
    )


@router.post("/keep", status_code=status.HTTP_204_NO_CONTENT)
def keep(body: NamesIn, _: SignedInAccount, service: SharedNamesDep) -> None:
    """Keep each name as naming one artist."""
    service.keep(body.names)


@router.post("/forget", status_code=status.HTTP_204_NO_CONTENT)
def forget(body: NamesIn, _: SignedInAccount, service: SharedNamesDep) -> None:
    """Forget that each name is kept as one, so it waits to be told apart again."""
    service.forget(body.names)
