"""The catalog API: Tracks with your favorites, ratings, and plays, and your Playlists."""

import uuid
from datetime import datetime

from fastapi import APIRouter, Response, status
from pydantic import AwareDatetime, BaseModel, Field

from medleyplay.application.rule_schema import RulesIn, rules_document, to_rules
from medleyplay.domain.catalog import (
    MAX_FAVORITE_NAME_LENGTH,
    MAX_PLAYLIST_LENGTH,
    MAX_RATING,
    MIN_RATING,
    Availability,
    Builtin,
    Favorites,
    Playlist,
    PlaylistId,
    Track,
    TrackId,
)
from medleyplay.domain.playback import PlayId
from medleyplay.web.deps import CatalogDep, SignedInAccount
from medleyplay.web.ids import RowId

router = APIRouter(prefix="/api", tags=["catalog"])


class TrackOut(BaseModel):
    """A Track with the signed-in Account's own state."""

    id: int
    title: str
    artist: str
    album: str
    album_artist: str
    track_number: int | None
    disc_number: int | None
    year: int | None
    genre: str
    duration_ms: int | None
    added_at: datetime
    favorite: bool
    rating: int | None
    play_count: int
    last_played_at: datetime | None
    availability: Availability
    downloaded: bool = Field(
        description="Whether a Source of the Track has a Download kept on the server."
    )
    download_failed: bool = Field(
        description="Whether the Track has no Download, and the last Job downloading it failed."
    )
    site: str | None = Field(
        description="The kind of site its audio is downloaded from, such as `bilibili`, if any."
    )
    segment_of: int | None = Field(description="The album file this Track is a song of, if any.")
    split: bool = Field(description="Whether this Track's file is split into songs.")
    cover: str | None = Field(description="The cover shown, served at `/api/covers/{cover}`.")

    @classmethod
    def of(cls, track: Track) -> "TrackOut":
        """Return the API view of `track`."""
        details = track.details
        return cls(
            id=track.id,
            title=details.title,
            artist=details.artist,
            album=details.album,
            album_artist=details.album_artist,
            track_number=details.track_number,
            disc_number=details.disc_number,
            year=details.year,
            genre=details.genre,
            duration_ms=details.duration_ms,
            added_at=track.added_at,
            favorite=track.favorite,
            rating=track.rating,
            play_count=track.play_count,
            last_played_at=track.last_played_at,
            availability=track.availability,
            downloaded=track.downloaded,
            download_failed=track.download_failed,
            site=track.site,
            segment_of=track.segment_of,
            split=track.split,
            cover=details.cover,
        )


class FavoriteIn(BaseModel):
    """Whether a Track is a favorite: an absolute value, so a retry is harmless."""

    favorite: bool


class ArtistFavoriteIn(BaseModel):
    """Whether an artist is a favorite, named as the Library names it."""

    name: str = Field(max_length=MAX_FAVORITE_NAME_LENGTH)
    favorite: bool


class AlbumFavoriteIn(BaseModel):
    """Whether an album is a favorite, by its album artist, else its artist, maybe blank."""

    artist: str = Field(max_length=MAX_FAVORITE_NAME_LENGTH)
    name: str = Field(max_length=MAX_FAVORITE_NAME_LENGTH)
    favorite: bool


class FavoriteArtistOut(BaseModel):
    """A favorite artist, by the name it was favorited under."""

    name: str


class FavoriteAlbumOut(BaseModel):
    """A favorite album, by the names it was favorited under."""

    artist: str
    name: str


class FavoritesOut(BaseModel):
    """The artists and albums you favorited."""

    artists: list[FavoriteArtistOut]
    albums: list[FavoriteAlbumOut]

    @classmethod
    def of(cls, favorites: Favorites) -> "FavoritesOut":
        """Return `favorites` as the API sends them."""
        return cls(
            artists=[FavoriteArtistOut(name=name) for name in favorites.artists],
            albums=[
                FavoriteAlbumOut(artist=album.artist, name=album.name) for album in favorites.albums
            ],
        )


class RatingIn(BaseModel):
    """A rating in stars, or `null` to clear it."""

    rating: int | None = Field(ge=MIN_RATING, le=MAX_RATING)


class PlayIn(BaseModel):
    """A play of a Track, and when it started; a time in the future is taken as now."""

    track_id: RowId
    played_at: AwareDatetime


class PlaylistIn(BaseModel):
    """A whole Playlist: its name, and its Tracks in order or its rules, never both."""

    name: str = Field(examples=["Morning"])
    track_ids: list[RowId] | None = Field(default=None, max_length=MAX_PLAYLIST_LENGTH)
    rules: RulesIn | None = None
    keep_downloaded: bool = False
    """Keep every Track the Playlist holds downloaded on the server."""


class KeepDownloadedIn(BaseModel):
    """Whether a Playlist keeps every Track it holds downloaded on the server."""

    keep_downloaded: bool


class PlaylistOut(BaseModel):
    """A Playlist; a smart one's Tracks are the ones its rules match now, newest added first."""

    id: uuid.UUID
    name: str
    track_ids: list[int]
    rules: dict[str, object] | None
    keep_downloaded: bool
    unreadable: str
    """Why the server can't read the Playlist's stored rules, or empty."""
    builtin: Builtin | None
    """Which Playlist the server keeps this is, such as `favorites`; it can't be edited
    or deleted, though its Keep downloaded switch changes."""
    updated_at: datetime

    @classmethod
    def of(cls, playlist: Playlist) -> "PlaylistOut":
        """Return the API view of `playlist`."""
        return cls(
            id=playlist.id,
            name=playlist.name,
            track_ids=list(playlist.track_ids),
            rules=None if playlist.rules is None else rules_document(playlist.rules),
            keep_downloaded=playlist.keep_downloaded,
            unreadable=playlist.unreadable,
            builtin=playlist.builtin,
            updated_at=playlist.updated_at,
        )


@router.get("/tracks")
def list_tracks(me: SignedInAccount, catalog: CatalogDep) -> list[TrackOut]:
    """Return every Track in the catalog."""
    return [TrackOut.of(track) for track in catalog.list_tracks(me.id)]


@router.get("/tracks/{track_id}")
def get_track(track_id: RowId, me: SignedInAccount, catalog: CatalogDep) -> TrackOut:
    """Return one Track."""
    return TrackOut.of(catalog.get_track(me.id, TrackId(track_id)))


@router.put("/tracks/{track_id}/favorite")
def set_favorite(
    track_id: RowId, body: FavoriteIn, me: SignedInAccount, catalog: CatalogDep
) -> TrackOut:
    """Mark or unmark a Track as your favorite."""
    track = catalog.set_favorite(me.id, TrackId(track_id), favorite=body.favorite)
    return TrackOut.of(track)


@router.get("/favorites")
def get_favorites(me: SignedInAccount, catalog: CatalogDep) -> FavoritesOut:
    """Return the artists and albums you favorited."""
    return FavoritesOut.of(catalog.favorites(me.id))


@router.put("/artists/favorite")
def set_artist_favorite(
    body: ArtistFavoriteIn, me: SignedInAccount, catalog: CatalogDep
) -> FavoritesOut:
    """Mark or unmark an artist as your favorite, and return your favorites."""
    catalog.set_artist_favorite(me.id, body.name, favorite=body.favorite)
    return FavoritesOut.of(catalog.favorites(me.id))


@router.put("/albums/favorite")
def set_album_favorite(
    body: AlbumFavoriteIn, me: SignedInAccount, catalog: CatalogDep
) -> FavoritesOut:
    """Mark or unmark an album as your favorite, and return your favorites."""
    catalog.set_album_favorite(me.id, body.artist, body.name, favorite=body.favorite)
    return FavoritesOut.of(catalog.favorites(me.id))


@router.put("/tracks/{track_id}/rating")
def set_rating(
    track_id: RowId, body: RatingIn, me: SignedInAccount, catalog: CatalogDep
) -> TrackOut:
    """Rate a Track 1-5 stars, or clear your rating."""
    return TrackOut.of(catalog.set_rating(me.id, TrackId(track_id), body.rating))


@router.put("/plays/{play_id}")
def record_play(
    play_id: uuid.UUID, body: PlayIn, me: SignedInAccount, catalog: CatalogDep
) -> TrackOut:
    """Record a play under an id you choose; sending it again changes nothing."""
    track = catalog.record_play(me.id, PlayId(play_id), TrackId(body.track_id), body.played_at)
    return TrackOut.of(track)


@router.get("/playlists")
def list_playlists(me: SignedInAccount, catalog: CatalogDep) -> list[PlaylistOut]:
    """Return your Playlists."""
    return [PlaylistOut.of(playlist) for playlist in catalog.list_playlists(me.id)]


@router.get("/playlists/{playlist_id}")
def get_playlist(playlist_id: uuid.UUID, me: SignedInAccount, catalog: CatalogDep) -> PlaylistOut:
    """Return one of your Playlists."""
    return PlaylistOut.of(catalog.get_playlist(me.id, PlaylistId(playlist_id)))


@router.put("/playlists/{playlist_id}")
def put_playlist(
    playlist_id: uuid.UUID,
    body: PlaylistIn,
    response: Response,
    me: SignedInAccount,
    catalog: CatalogDep,
) -> PlaylistOut:
    """Create or replace a Playlist under an id you choose; 201 when new, 200 when replaced."""
    track_ids = None if body.track_ids is None else [TrackId(i) for i in body.track_ids]
    if track_ids is None and body.rules is None:
        track_ids = []
    playlist, created = catalog.put_playlist(
        me.id,
        PlaylistId(playlist_id),
        body.name,
        track_ids,
        rules=None if body.rules is None else to_rules(body.rules),
        keep_downloaded=body.keep_downloaded,
    )
    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return PlaylistOut.of(playlist)


@router.put("/playlists/{playlist_id}/keep_downloaded")
def put_keep_downloaded(
    playlist_id: uuid.UUID, body: KeepDownloadedIn, me: SignedInAccount, catalog: CatalogDep
) -> PlaylistOut:
    """Switch whether one of your Playlists keeps its Tracks downloaded; Favorites' too."""
    playlist = catalog.set_keep_downloaded(
        me.id, PlaylistId(playlist_id), keep=body.keep_downloaded
    )
    return PlaylistOut.of(playlist)


@router.delete("/playlists/{playlist_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_playlist(playlist_id: uuid.UUID, me: SignedInAccount, catalog: CatalogDep) -> None:
    """Delete one of your Playlists; deleting it twice is fine."""
    catalog.delete_playlist(me.id, PlaylistId(playlist_id))
