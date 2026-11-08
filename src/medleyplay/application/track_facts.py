"""What smart-playlist rules may ask of each Track, read from the catalog for one Account.

A file split into songs gives way to its songs, which each take its Sources' kinds. A
Track's rating is the Account's own, else its rating of the Track's album.
"""

from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from medleyplay.application.album_ratings import album_ratings_of, library_album_of
from medleyplay.application.segments import album_file_of
from medleyplay.domain.accounts import AccountId
from medleyplay.domain.album_ratings import AlbumRatings, effective_rating
from medleyplay.domain.catalog import TrackId
from medleyplay.domain.rules import TrackFacts
from medleyplay.persistence.schema import SourceRow, TrackRow, TrackStateRow


def track_facts(
    db: Session, account_id: AccountId, album_ratings: AlbumRatings | None = None
) -> dict[TrackId, TrackFacts]:
    """Return every Track's facts as `account_id` sees them; an untouched Track reads as new.

    `album_ratings` stands in for the Account's own, to see what an import would change.
    """
    rated = album_ratings_of(db, account_id) if album_ratings is None else album_ratings
    kinds: defaultdict[int, set[str]] = defaultdict(set)
    for track_id, kind in db.execute(select(SourceRow.track_id, SourceRow.kind)):
        kinds[track_id].add(kind)
    album_of = album_file_of(db)
    for song, album in album_of.items():
        kinds[song] = kinds[album]
    split = set(album_of.values())
    rows = db.execute(
        select(TrackRow, TrackStateRow).outerjoin(
            TrackStateRow,
            (TrackStateRow.track_id == TrackRow.id) & (TrackStateRow.account_id == account_id),
        )
    )
    return {
        TrackId(track.id): _facts(
            track, state, frozenset(kinds[track.id]), rated.stars_of(*library_album_of(track))
        )
        for track, state in rows
        if track.id not in split
    }


def _facts(
    track: TrackRow, state: TrackStateRow | None, kinds: frozenset[str], album_rating: int | None
) -> TrackFacts:
    # An Account that never touched a Track has no state for it: not a favorite, never played.
    return TrackFacts(
        title=track.title,
        artist=track.artist,
        album=track.album,
        added_at=track.added_at,
        favorite=state is not None and state.favorite,
        rating=effective_rating(None if state is None else state.rating, album_rating),
        play_count=0 if state is None else state.play_count,
        last_played_at=None if state is None else state.last_played_at,
        source_kinds=kinds,
    )
