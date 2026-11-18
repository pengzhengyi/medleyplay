"""Artists sharing a name: a name's songs told apart album by album, or the name kept as one.

A name is listed when MusicBrainz knows two or more artists going by it exactly, each
scored high, or when it names several of the Library's artists already. Its songs are
listed by album and by the artist each is bound to now; songs whose artist the
household chose are confirmed. A name naming several artists waits while any of its
songs isn't; a name naming one waits, when MusicBrainz knows several by it, until it
is told apart or kept as one. Nothing changes on its own.
"""

from collections import Counter
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import delete, select
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application import Clock
from medleyplay.application.artists import names_going_by
from medleyplay.application.track_artists import (
    SongsBy,
    album_of,
    assign_songs,
    every_name_artists,
)
from medleyplay.domain.artists import artist_key
from medleyplay.domain.catalog import TrackId
from medleyplay.persistence.schema import (
    LibraryArtistRow,
    NameKeptRow,
    TrackArtistChoiceRow,
    TrackArtistRow,
    TrackRow,
)


@dataclass(frozen=True)
class ArtistOfName:
    """One of the Library's artists a name names, the MusicBrainz artist it is, and its songs."""

    artist_id: str
    musicbrainz_id: str | None
    songs: int
    """How many songs writing the name are bound to it."""


@dataclass(frozen=True)
class AlbumSongs:
    """The songs of one album writing a name that are bound to one artist."""

    album: str
    """The album, as most of its songs write it; empty for songs on none."""
    track_ids: tuple[TrackId, ...]
    artist_id: str
    confirmed: bool
    """Whether the household chose the artist of every one of them."""


@dataclass(frozen=True)
class SharedName:
    """A name that may name several artists: the artists it names, and its songs by album."""

    name: str
    artists: tuple[ArtistOfName, ...]
    """The Library's artists the name names, its first first."""
    known: tuple[str, ...]
    """The MusicBrainz artists going by the name exactly, scored high, best first."""
    kept: bool
    """Whether the household keeps the name as naming one artist."""
    albums: tuple[AlbumSongs, ...]
    """The name's songs by album and artist, most songs first."""

    @property
    def waiting(self) -> bool:
        """Whether the household has songs of the name to confirm, or the name to tell apart."""
        if len(self.artists) > 1:
            return not all(each.confirmed for each in self.albums)
        return len(self.known) > 1 and not self.kept


class SharedNameService:
    """List the names that may name several artists, and tell their songs apart or keep them."""

    def __init__(
        self,
        units: sessionmaker[Session],
        clock: Clock,
        on_change: Callable[[str], None] | None = None,
    ) -> None:
        """Create a service over the database `units` open, telling `on_change` of each change."""
        self._units = units
        self._clock = clock
        self._on_change = on_change

    def names(self) -> tuple[SharedName, ...]:
        """Return every name that may name several artists, most songs first."""
        with self._units() as db:
            named = every_name_artists(db)
            going_by = names_going_by(db)
            keys = {key for key, ids in named.items() if len(ids) > 1} | {
                key for key, ids in going_by.items() if len(ids) > 1 and key in named
            }
            if not keys:
                return ()
            kept = set(db.scalars(select(NameKeptRow.key).where(NameKeptRow.key.in_(keys))))
            # A Result has keys(), so dict() would read it as a mapping.
            linked = {  # noqa: C416
                id_: musicbrainz_id
                for id_, musicbrainz_id in db.execute(
                    select(LibraryArtistRow.id, LibraryArtistRow.musicbrainz_id).where(
                        LibraryArtistRow.id.in_({id_ for key in keys for id_ in named[key]})
                    )
                )
            }
            chosen = {
                (track_id, key)
                for track_id, key in db.execute(
                    select(TrackArtistChoiceRow.track_id, TrackArtistChoiceRow.key).where(
                        TrackArtistChoiceRow.key.in_(keys)
                    )
                )
            }
            songs = _songs_by_name(db, keys)
        found = [
            _shared(
                key,
                songs.get(key, {}),
                [ArtistOfName(id_, linked.get(id_), 0) for id_ in named[key]],
                going_by.get(key, ()),
                kept=key in kept,
                chosen=chosen,
            )
            for key in keys
        ]
        found.sort(key=lambda each: (-sum(a.songs for a in each.artists), artist_key(each.name)))
        return tuple(found)

    def assign(self, name: str, chosen: Sequence[SongsBy]) -> None:
        """Bind each of the name's songs chosen to the artist chosen for it, and confirm it.

        A name left naming one artist is kept as one.
        """
        with self._units.begin() as db:
            now = self._clock()
            assign_songs(db, name, chosen, now)
            key = artist_key(name)
            if len(every_name_artists(db).get(key, ())) == 1:
                _keep(db, key, name.strip(), now)
        self._changed()

    def keep(self, names: Iterable[str]) -> None:
        """Keep each name as naming one artist, so it waits no more."""
        with self._units.begin() as db:
            now = self._clock()
            for name in dict.fromkeys(name.strip() for name in names):
                _keep(db, artist_key(name), name, now)
        self._changed()

    def forget(self, names: Iterable[str]) -> None:
        """Forget that each name is kept as one, so it waits to be told apart again."""
        keys = {artist_key(name) for name in names}
        with self._units.begin() as db:
            db.execute(delete(NameKeptRow).where(NameKeptRow.key.in_(keys)))
        self._changed()

    def _changed(self) -> None:
        if self._on_change is not None:
            self._on_change("catalog")


@dataclass(frozen=True)
class _Song:
    """A song writing a name, as the name is written there, and the artist it is bound to."""

    track: TrackRow
    written: str
    artist_id: str


def _songs_by_name(db: Session, keys: set[str]) -> dict[str, dict[int, _Song]]:
    """Return the songs writing each of the names `keys`, by name and then by Track id."""
    found: dict[str, dict[int, _Song]] = {}
    rows = db.execute(
        select(TrackArtistRow.written, TrackArtistRow.artist_id, TrackRow)
        .join(TrackRow, TrackRow.id == TrackArtistRow.track_id)
        .order_by(TrackRow.id, TrackArtistRow.album_artist, TrackArtistRow.position)
    )
    for written, artist_id, track in rows:
        key = artist_key(written)
        if key in keys:
            found.setdefault(key, {}).setdefault(track.id, _Song(track, written, artist_id))
    return found


def _shared(
    key: str,
    songs: dict[int, _Song],
    artists: list[ArtistOfName],
    known: tuple[str, ...],
    *,
    kept: bool,
    chosen: set[tuple[int, str]],
) -> SharedName:
    """Return the name `key` with its songs by album and artist, and how many each artist has."""
    groups: dict[tuple[tuple[str, str] | None, str], list[_Song]] = {}
    for song in songs.values():
        groups.setdefault((album_of(song.track), song.artist_id), []).append(song)
    albums = [
        AlbumSongs(
            album=Counter(each.track.album.strip() for each in group).most_common(1)[0][0],
            track_ids=tuple(TrackId(each.track.id) for each in group),
            artist_id=artist_id,
            confirmed=all((each.track.id, key) in chosen for each in group),
        )
        for (_, artist_id), group in groups.items()
    ]
    albums.sort(key=lambda each: (-len(each.track_ids), each.album))
    counts = Counter(song.artist_id for song in songs.values())
    written = Counter(song.written for song in songs.values()).most_common(1)
    return SharedName(
        name=written[0][0] if written else key,
        artists=tuple(
            ArtistOfName(each.artist_id, each.musicbrainz_id, counts[each.artist_id])
            for each in artists
        ),
        known=known,
        kept=kept,
        albums=tuple(albums),
    )


def _keep(db: Session, key: str, written: str, now: datetime) -> None:
    """Keep the name `key` as naming one artist."""
    db.execute(
        insert(NameKeptRow)
        .values(key=key, written=written, kept_at=now)
        .on_conflict_do_update(index_elements=["key"], set_={"written": written, "kept_at": now})
    )
