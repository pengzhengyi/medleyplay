"""Each Track's artists by id: every artist and album artist it shows, bound to one artist.

An artist is the Library's own, under an id it keeps when it is linked to a MusicBrainz
artist or unlinked. Each written name, folded, names one artist; names linked to one
MusicBrainz artist name the same one. A Track's artists are bound again whenever its
shown artist or album artist changes, and a name's Tracks whenever its link changes.
"""

import uuid
from dataclasses import dataclass

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from medleyplay.domain.artists import artist_key
from medleyplay.domain.catalog import TrackId
from medleyplay.persistence.schema import (
    ArtistLinkRow,
    ArtistNameRow,
    LibraryArtistRow,
    TrackArtistRow,
    TrackRow,
)


@dataclass(frozen=True)
class BoundArtist:
    """One artist a Track shows, and how the Track writes its name."""

    artist_id: str
    written: str


@dataclass(frozen=True)
class TrackArtists:
    """The artists a Track shows as its artists and as its album artists, in order."""

    artists: tuple[BoundArtist, ...]
    album_artists: tuple[BoundArtist, ...]


def artists_of(db: Session, track_id: TrackId) -> TrackArtists:
    """Return the artists the Track shows."""
    rows = db.scalars(
        select(TrackArtistRow)
        .where(TrackArtistRow.track_id == track_id)
        .order_by(TrackArtistRow.position)
    ).all()
    bound = [(row.album_artist, BoundArtist(row.artist_id, row.written)) for row in rows]
    return TrackArtists(
        artists=tuple(artist for album, artist in bound if not album),
        album_artists=tuple(artist for album, artist in bound if album),
    )


def bind(db: Session, track: TrackRow) -> None:
    """Bind the artist and album artist the Track shows, each to the artist its name names."""
    db.execute(delete(TrackArtistRow).where(TrackArtistRow.track_id == track.id))
    for album_artist, shown in ((False, track.artist), (True, track.album_artist)):
        written = shown.strip()
        if written:
            artist_id = _artist_named(db, written)
            db.add(
                TrackArtistRow(
                    track_id=track.id,
                    album_artist=album_artist,
                    position=0,
                    artist_id=artist_id,
                    written=written,
                )
            )
    db.flush()


def rebind_name(db: Session, name: str, musicbrainz_id: str | None) -> None:
    """Make the artist `name` names the one linked to `musicbrainz_id`, or one linked to none.

    The name joins the artist already linked to `musicbrainz_id`, if one is. Otherwise
    its artist is linked in place when the name is its only one, so the artist keeps
    its id; or else the name parts from it as an artist of its own.
    """
    key = artist_key(name)
    named = db.get(ArtistNameRow, key)
    if named is None:
        # No Track shows the name yet; the first to show it takes the link then.
        return
    artist = db.get_one(LibraryArtistRow, named.artist_id)
    if artist.musicbrainz_id == musicbrainz_id:
        return
    joined = _linked_to(db, musicbrainz_id)
    only_name = _names_of(db, artist.id) == [key]
    if joined is not None:
        _move(db, key, artist.id, joined.id)
        if only_name:
            db.delete(artist)
    elif only_name:
        artist.musicbrainz_id = musicbrainz_id
    else:
        parted = _new_artist(db, name.strip(), musicbrainz_id)
        _move(db, key, artist.id, parted.id)
    db.flush()


def _artist_named(db: Session, written: str) -> str:
    """Return the id of the artist `written` names, adding one for a name new to the Library."""
    key = artist_key(written)
    named = db.get(ArtistNameRow, key)
    if named is not None:
        return named.artist_id
    link = db.get(ArtistLinkRow, key)
    musicbrainz_id = None if link is None else link.artist_id
    artist = _linked_to(db, musicbrainz_id) or _new_artist(db, written, musicbrainz_id)
    db.add(ArtistNameRow(key=key, artist_id=artist.id))
    db.flush()
    return artist.id


def _linked_to(db: Session, musicbrainz_id: str | None) -> LibraryArtistRow | None:
    if musicbrainz_id is None:
        return None
    return db.scalar(
        select(LibraryArtistRow).where(LibraryArtistRow.musicbrainz_id == musicbrainz_id)
    )


def _new_artist(db: Session, name: str, musicbrainz_id: str | None) -> LibraryArtistRow:
    artist = LibraryArtistRow(id=uuid.uuid4().hex, name=name, musicbrainz_id=musicbrainz_id)
    db.add(artist)
    db.flush()
    return artist


def _names_of(db: Session, artist_id: str) -> list[str]:
    return list(db.scalars(select(ArtistNameRow.key).where(ArtistNameRow.artist_id == artist_id)))


def _move(db: Session, key: str, from_id: str, to_id: str) -> None:
    """Point the name `key`, and every Track row writing it, from one artist to another."""
    db.execute(update(ArtistNameRow).where(ArtistNameRow.key == key).values(artist_id=to_id))
    rows = db.scalars(select(TrackArtistRow).where(TrackArtistRow.artist_id == from_id))
    for row in rows:
        if artist_key(row.written) == key:
            row.artist_id = to_id
    db.flush()
