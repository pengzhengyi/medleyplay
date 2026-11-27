"""Catalog lyrics availability from each song's selected source and complete album membership."""

from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import replace
from itertools import batched

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from medleyplay.domain.catalog import Track, TrackId
from medleyplay.domain.details import Kind
from medleyplay.domain.errors import InvalidInputError
from medleyplay.domain.lyrics import LyricsOrigin, parse_lyrics
from medleyplay.persistence.schema import TrackLyricsRow


def with_lyrics_availability(
    db: Session, tracks: Sequence[Track], segment_of: Mapping[TrackId, TrackId]
) -> list[Track]:
    """Set availability from readable song lyrics, or every child of a split album."""
    albums = {track.id for track in tracks if track.split}
    children: dict[TrackId, set[TrackId]] = defaultdict(set)
    for song, album in segment_of.items():
        if album in albums:
            children[album].add(song)
    songs = {track.id for track in tracks if track.kind is Kind.SONG}
    songs.update(song for members in children.values() for song in members)
    readable = _readable_songs(db, songs)
    complete = {album for album, members in children.items() if members <= readable}
    return [
        replace(track, has_lyrics=track.id in readable or track.id in complete) for track in tracks
    ]


def _readable_songs(db: Session, track_ids: set[TrackId]) -> set[TrackId]:
    priority = case(
        {origin.value: index for index, origin in enumerate(LyricsOrigin)},
        value=TrackLyricsRow.origin,
    )
    readable: set[TrackId] = set()
    for batch in batched(sorted(track_ids), 500, strict=False):
        ranked = (
            select(
                TrackLyricsRow.track_id,
                TrackLyricsRow.origin,
                func.row_number()
                .over(partition_by=TrackLyricsRow.track_id, order_by=priority)
                .label("priority"),
            )
            .where(TrackLyricsRow.track_id.in_(batch), ~TrackLyricsRow.dismissed)
            .subquery()
        )
        winners = (
            select(TrackLyricsRow.track_id, TrackLyricsRow.text)
            .join(
                ranked,
                (TrackLyricsRow.track_id == ranked.c.track_id)
                & (TrackLyricsRow.origin == ranked.c.origin),
            )
            .where(
                ranked.c.priority == 1,
                TrackLyricsRow.origin != LyricsOrigin.SUGGESTED,
                ~TrackLyricsRow.instrumental,
            )
        )
        for track_id, text in db.execute(winners):
            try:
                lyrics = parse_lyrics(text)
            except InvalidInputError:
                continue
            if lyrics.plain.strip() or any(
                line.text.strip() or line.translation.strip() for line in lyrics.lines
            ):
                readable.add(TrackId(track_id))
    return readable
