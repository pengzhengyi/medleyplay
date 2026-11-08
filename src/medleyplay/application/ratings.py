"""An Account's ratings: importing its album ratings from Rate Your Music, and exporting them.

An import previews before it applies, since an album's rating stands for every song
on it the Account hasn't rated, and so moves songs in and out of smart playlists.
Importing again replaces the earlier import; a song's own rating is never touched.
"""

import csv
import io
from dataclasses import dataclass
from datetime import datetime
from typing import Final

from sqlalchemy import delete, func, insert, select
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application import Clock
from medleyplay.application.album_ratings import album_ratings_of, library_album_of
from medleyplay.application.changes import OnChange
from medleyplay.application.rule_schema import read_rules
from medleyplay.application.track_facts import track_facts
from medleyplay.domain.accounts import AccountId
from medleyplay.domain.album_ratings import AlbumRatings, LibraryAlbums, RatedAlbum, album_keys
from medleyplay.domain.catalog import PlaylistId, TrackId
from medleyplay.domain.errors import InvalidInputError
from medleyplay.domain.rules import TrackFacts, fold, matches
from medleyplay.domain.rym import RymAlbum, read_rym_export
from medleyplay.persistence.schema import AlbumRatingRow, PlaylistRow, TrackRow, TrackStateRow

EXPORT_COLUMNS: Final = ("Rated", "Artist", "Album", "Title", "Stars", "Review")
_FORMULA_STARTS: Final = tuple("=+-@\t\r")


@dataclass(frozen=True)
class PlaylistChange:
    """How many songs an import moves into, and out of, one of the Account's smart playlists."""

    playlist_id: PlaylistId
    name: str
    joining: int
    leaving: int


@dataclass(frozen=True)
class ImportSummary:
    """What importing an export changes, or changed, for the Account.

    `albums` it rated or reviewed, of which the Library has `matched_albums`;
    `songs` whose rating changes; the albums the Library hasn't, each its artist and
    name; the smart playlists songs join or leave; and how many albums the earlier
    import had, which this one replaces.
    """

    albums: int
    matched_albums: int
    songs: int
    unmatched: tuple[tuple[str, str], ...]
    playlists: tuple[PlaylistChange, ...]
    replaced_albums: int


@dataclass(frozen=True)
class AlbumRating:
    """The Account's imported rating of one album, if it rated it, and its review."""

    stars: int | None
    note: str


class RatingsService:
    """Imports and exports each Account's ratings."""

    def __init__(
        self, units: sessionmaker[Session], clock: Clock, on_change: OnChange | None = None
    ) -> None:
        """Keep ratings through `units`; `on_change` hears `catalog` when an import changes them."""
        self._units = units
        self._clock = clock
        self._on_change = on_change

    def preview_import(self, account_id: AccountId, data: bytes) -> ImportSummary:
        """Return what importing the export `data` would change, changing nothing."""
        albums = _read(data)
        with self._units() as db:
            return _summary(db, account_id, albums, self._clock())

    def import_ratings(self, account_id: AccountId, data: bytes) -> ImportSummary:
        """Replace the Account's imported album ratings with the export `data`'s."""
        albums = _read(data)
        with self._units.begin() as db:
            summary = _summary(db, account_id, albums, self._clock())
            db.execute(delete(AlbumRatingRow).where(AlbumRatingRow.account_id == account_id))
            db.execute(insert(AlbumRatingRow), [_row_of(account_id, album) for album in albums])
        self._changed()
        return summary

    def forget_import(self, account_id: AccountId) -> None:
        """Forget every album rating the Account imported; its songs' own ratings stay."""
        with self._units.begin() as db:
            db.execute(delete(AlbumRatingRow).where(AlbumRatingRow.account_id == account_id))
        self._changed()

    def album_rating(self, account_id: AccountId, artist: str, album: str) -> AlbumRating | None:
        """Return the Account's imported rating of the Library album `album` by `artist`."""
        with self._units() as db:
            found = album_ratings_of(db, account_id).find(artist, album)
        return None if found is None else AlbumRating(found.stars, found.note)

    def export(self, account_id: AccountId) -> str:
        """Return the Account's ratings as CSV: the songs it rated, then the albums it imported.

        A value a spreadsheet would run as a formula starts with `'`, which it shows.
        """
        with self._units() as db:
            songs = db.execute(
                select(TrackRow, TrackStateRow.rating)
                .join(TrackStateRow, TrackStateRow.track_id == TrackRow.id)
                .where(TrackStateRow.account_id == account_id, TrackStateRow.rating.is_not(None))
                .order_by(TrackRow.id)
            ).all()
            albums = db.scalars(
                select(AlbumRatingRow)
                .where(AlbumRatingRow.account_id == account_id)
                .order_by(AlbumRatingRow.id)
            ).all()
        written = io.StringIO()
        writer = csv.writer(written, lineterminator="\r\n")
        writer.writerow(EXPORT_COLUMNS)
        for track, rating in songs:
            writer.writerow(_cells("song", track.artist, track.album, track.title, rating, ""))
        for row in albums:
            writer.writerow(_cells("album", row.artist, row.album, "", row.stars, row.note))
        return written.getvalue()

    def _changed(self) -> None:
        if self._on_change is not None:
            self._on_change("catalog")


def _read(data: bytes) -> tuple[RymAlbum, ...]:
    albums = read_rym_export(data)
    if not albums:
        message = "The export rates and reviews no album, so importing it would change nothing."
        raise InvalidInputError(message)
    return albums


def _summary(
    db: Session, account_id: AccountId, albums: tuple[RymAlbum, ...], now: datetime
) -> ImportSummary:
    rated = [_rated(album) for album in albums]
    before = track_facts(db, account_id)
    after = track_facts(db, account_id, AlbumRatings(rated))
    library = LibraryAlbums(library_album_of(track) for track in db.scalars(select(TrackRow)))
    has = [library.has(each) for each in rated]
    replaced = db.scalar(
        select(func.count())
        .select_from(AlbumRatingRow)
        .where(AlbumRatingRow.account_id == account_id)
    )
    return ImportSummary(
        albums=len(albums),
        matched_albums=sum(has),
        songs=sum(
            1 for track_id, facts in after.items() if facts.rating != before[track_id].rating
        ),
        unmatched=tuple(
            (album.artist, album.album)
            for album, found in zip(albums, has, strict=True)
            if not found
        ),
        playlists=_playlist_changes(db, account_id, before, after, now),
        replaced_albums=replaced or 0,
    )


def _playlist_changes(
    db: Session,
    account_id: AccountId,
    before: dict[TrackId, TrackFacts],
    after: dict[TrackId, TrackFacts],
    now: datetime,
) -> tuple[PlaylistChange, ...]:
    """Return the Account's smart playlists the change moves songs into or out of, by name."""
    changes: list[PlaylistChange] = []
    playlists = db.scalars(
        select(PlaylistRow)
        .where(PlaylistRow.account_id == account_id, PlaylistRow.rules.is_not(None))
        .order_by(PlaylistRow.builtin.is_(None), PlaylistRow.name, PlaylistRow.id)
    )
    for playlist in playlists:
        try:
            rules = read_rules(playlist.rules)
        except InvalidInputError:
            continue
        was = {track_id for track_id, facts in before.items() if matches(rules, facts, now)}
        will = {track_id for track_id, facts in after.items() if matches(rules, facts, now)}
        if was != will:
            change = PlaylistChange(
                PlaylistId(playlist.id), playlist.name, len(will - was), len(was - will)
            )
            changes.append(change)
    return tuple(changes)


def _rated(album: RymAlbum) -> RatedAlbum:
    return RatedAlbum.of(
        artist=album.artist,
        artist_localized=album.artist_localized,
        album=album.album,
        stars=album.stars,
        note=album.note,
    )


def _row_of(account_id: AccountId, album: RymAlbum) -> dict[str, object]:
    album_key, plain_key = album_keys(album.album)
    return {
        "account_id": account_id,
        "source_id": album.rym_id,
        "artist": album.artist,
        "artist_localized": album.artist_localized,
        "album": album.album,
        "artist_key": fold(album.artist),
        "localized_key": fold(album.artist_localized),
        "album_key": album_key,
        "plain_key": plain_key,
        "stars": album.stars,
        "note": album.note,
    }


def _cells(*values: str | int | None) -> list[str]:
    cells = ["" if value is None else str(value) for value in values]
    return ["'" + cell if cell.lstrip(" ").startswith(_FORMULA_STARTS) else cell for cell in cells]
