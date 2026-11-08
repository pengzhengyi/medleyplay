"""Reading each Account's imported album ratings, for the readers of a song's rating."""

from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from medleyplay.domain.accounts import AccountId
from medleyplay.domain.album_ratings import AlbumRatings, RatedAlbum
from medleyplay.persistence.schema import AlbumRatingRow, TrackRow


def album_ratings_of(db: Session, account_id: AccountId) -> AlbumRatings:
    """Return the albums `account_id` rated or reviewed, as its last import named them."""
    rows = db.scalars(select(AlbumRatingRow).where(AlbumRatingRow.account_id == account_id))
    return AlbumRatings(rated_album_of(row) for row in rows)


def album_ratings_by_account(db: Session) -> dict[AccountId, AlbumRatings]:
    """Return the albums each Account that imported any rated or reviewed."""
    rated: defaultdict[AccountId, list[RatedAlbum]] = defaultdict(list)
    for row in db.scalars(select(AlbumRatingRow)):
        rated[AccountId(row.account_id)].append(rated_album_of(row))
    return {account_id: AlbumRatings(albums) for account_id, albums in rated.items()}


def library_album_of(track: TrackRow) -> tuple[str, str]:
    """Return the album a Track is on, as the Library groups it: its artist and name."""
    return track.album_artist or track.artist, track.album


def rated_album_of(row: AlbumRatingRow) -> RatedAlbum:
    """Return an album rating as kept, by the keys it was kept under."""
    keys = frozenset({row.artist_key, row.localized_key} - {""})
    return RatedAlbum(keys, row.album_key, row.plain_key, row.stars, row.note)
