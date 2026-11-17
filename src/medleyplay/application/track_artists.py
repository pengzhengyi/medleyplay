"""Each Track's artists by id: every artist and album artist it shows, bound to one artist.

An artist is the Library's own, under an id it keeps when it is linked to a MusicBrainz
artist or unlinked. Each written name, folded, names one artist; names linked to one
MusicBrainz artist name the same one. A name the household split is bound as each
artist it lists, with how the song credits it; a song whose artists the household
chose one by one is bound as those, while its artist is them written as one. A
Track's artists are bound again whenever its shown artist or album artist changes,
and a name's Tracks whenever its link changes or it is split or kept.
"""

import uuid
from collections.abc import Iterable
from dataclasses import dataclass

from sqlalchemy import delete, select, update
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.orm import Session

from medleyplay.domain.artist_split import Credit, Role, credited_as, split_suggestion
from medleyplay.domain.artists import artist_key
from medleyplay.domain.catalog import TrackId
from medleyplay.persistence.schema import (
    ArtistHouseholdRow,
    ArtistLinkRow,
    ArtistNameRow,
    ArtistRow,
    FavoriteArtistRow,
    LibraryArtistRow,
    NameSplitRow,
    TrackArtistRow,
    TrackCreditsRow,
    TrackRow,
)


@dataclass(frozen=True)
class BoundArtist:
    """One artist a Track shows, how the Track writes its name, and how it credits it."""

    artist_id: str
    written: str
    role: Role = Role.MAIN


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
    bound = [
        (row.album_artist, BoundArtist(row.artist_id, row.written, Role(row.role))) for row in rows
    ]
    return TrackArtists(
        artists=tuple(artist for album, artist in bound if not album),
        album_artists=tuple(artist for album, artist in bound if album),
    )


@dataclass(frozen=True)
class LinkedArtist:
    """The MusicBrainz artist one of the Library's artists is, by its name and photo."""

    musicbrainz_id: str
    name: str
    photo: str | None


def linked_artists(db: Session, artist_ids: Iterable[str]) -> dict[str, LinkedArtist]:
    """Return the MusicBrainz artist each of the Library's artists `artist_ids` is, if linked.

    The household's photo of the artist shows in place of Wikidata's.
    """
    rows = db.execute(
        select(LibraryArtistRow.id, ArtistRow, ArtistHouseholdRow.photo)
        .join(ArtistRow, ArtistRow.id == LibraryArtistRow.musicbrainz_id)
        .outerjoin(ArtistHouseholdRow, ArtistHouseholdRow.artist_id == ArtistRow.id)
        .where(LibraryArtistRow.id.in_(list(artist_ids)))
    )
    return {
        library_id: LinkedArtist(artist.id, artist.name, own_photo or artist.photo)
        for library_id, artist, own_photo in rows
    }


def artist_names_of(
    db: Session, track_id: TrackId | None = None
) -> dict[int, tuple[tuple[str, str], ...]]:
    """Return the artists each Track's artist names, in order, or one Track's.

    Each is the name as the Track writes it, and the id of the artist it is bound to.
    """
    query = (
        select(TrackArtistRow.track_id, TrackArtistRow.written, TrackArtistRow.artist_id)
        .where(TrackArtistRow.album_artist.is_(False))
        .order_by(TrackArtistRow.track_id, TrackArtistRow.position)
    )
    if track_id is not None:
        query = query.where(TrackArtistRow.track_id == track_id)
    found: dict[int, list[tuple[str, str]]] = {}
    for each, written, artist_id in db.execute(query):
        found.setdefault(each, []).append((written, artist_id))
    return {each: tuple(names) for each, names in found.items()}


def bind(db: Session, track: TrackRow) -> None:
    """Bind the artist and album artist the Track shows, each to the artist its name names."""
    db.execute(delete(TrackArtistRow).where(TrackArtistRow.track_id == track.id))
    chosen = chosen_credits(db, TrackId(track.id))
    for album_artist, shown in ((False, track.artist), (True, track.album_artist)):
        credited = (
            chosen
            if not album_artist and chosen is not None and credited_as(chosen) == shown.strip()
            else _credits(db, shown)
        )
        for position, credit in enumerate(credited):
            db.add(
                TrackArtistRow(
                    track_id=track.id,
                    album_artist=album_artist,
                    position=position,
                    artist_id=_artist_named(db, credit.written),
                    written=credit.written,
                    role=credit.role,
                )
            )
    db.flush()


def chosen_credits(db: Session, track_id: TrackId) -> tuple[Credit, ...] | None:
    """Return the artists the household chose for the song one by one, if it did."""
    row = db.get(TrackCreditsRow, track_id)
    if row is None:
        return None
    return tuple(Credit(each["written"], Role(each["role"])) for each in row.credits)


def chosen_tracks(db: Session) -> set[int]:
    """Return the ids of the songs whose artists the household chose one by one."""
    return set(db.scalars(select(TrackCreditsRow.track_id)))


def rebind_written(db: Session, keys: set[str]) -> None:
    """Bind again every Track whose artist or album artist is written as one of the names `keys`."""
    tracks = db.scalars(
        select(TrackRow).where((TrackRow.artist != "") | (TrackRow.album_artist != ""))
    )
    for track in tracks:
        if keys & {artist_key(track.artist), artist_key(track.album_artist)}:
            bind(db, track)


def _credits(db: Session, shown: str) -> tuple[Credit, ...]:
    """Return the artists `shown` lists: each one if the household split it, else itself."""
    written = shown.strip()
    if not written:
        return ()
    decided = db.get(NameSplitRow, artist_key(written))
    if decided is not None and decided.split:
        return split_suggestion(written) or tuple(
            Credit(part["written"], Role(part["role"])) for part in decided.parts
        )
    return (Credit(written),)


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
            _move_favorites(db, artist.id, joined.id)
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


def _move_favorites(db: Session, from_id: str, to_id: str) -> None:
    """Make every favorite of one artist a favorite of another, which it is joining."""
    accounts = db.scalars(
        select(FavoriteArtistRow.account_id).where(FavoriteArtistRow.artist_id == from_id)
    ).all()
    for account_id in accounts:
        db.execute(
            insert(FavoriteArtistRow)
            .values(account_id=account_id, artist_id=to_id)
            .on_conflict_do_nothing()
        )
    db.execute(delete(FavoriteArtistRow).where(FavoriteArtistRow.artist_id == from_id))


def _move(db: Session, key: str, from_id: str, to_id: str) -> None:
    """Point the name `key`, and every Track row writing it, from one artist to another."""
    db.execute(update(ArtistNameRow).where(ArtistNameRow.key == key).values(artist_id=to_id))
    rows = db.scalars(select(TrackArtistRow).where(TrackArtistRow.artist_id == from_id))
    for row in rows:
        if artist_key(row.written) == key:
            row.artist_id = to_id
    db.flush()
