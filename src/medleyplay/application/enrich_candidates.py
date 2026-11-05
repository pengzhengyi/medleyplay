"""What decides, for each Track, whether an enricher is asked about it.

An enricher that reads videos is asked about a Track's video. One that searches by
words is asked about the Track's title and artist, or, for a long file split into
songs, its album: what a Track would be searched for with is kept apart from what the
searched site said before, so its answer doesn't change the question. One that reads
a Track's video text is asked about the Track alone.
"""

from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from pathlib import PurePosixPath

from sqlalchemy import select
from sqlalchemy.orm import Session

from medleyplay.application.details import OriginValues
from medleyplay.application.segments import album_file_of
from medleyplay.domain.catalog import TrackId
from medleyplay.domain.details import Field, Origin
from medleyplay.domain.enrichers import (
    Enricher,
    Subject,
    TrackFacts,
    search_terms,
    text_subject,
    video_id_of,
)
from medleyplay.domain.libraries import LIBRARY_SOURCE, path_of_locator
from medleyplay.domain.links import BILIBILI_SOURCE
from medleyplay.persistence.schema import (
    EnricherAskRow,
    SegmentRow,
    SourceRow,
    TrackRow,
    TrackValueRow,
    VideoTextRow,
)

_WORDS = (Field.TITLE, Field.ARTIST, Field.ALBUM, Field.ALBUM_ARTIST)


@dataclass(frozen=True)
class Candidate:
    """A Track, with what decides whether it is asked about and what it is asked with."""

    facts: TrackFacts
    file_name: str
    video: str | None
    """The Track's video, when the enricher reads videos and the Track has one."""
    whole_album: bool
    """The Track is a long file split into songs."""


def candidates(
    db: Session, enricher: Enricher, track_ids: Sequence[TrackId] | None
) -> dict[TrackId, Candidate]:
    """Return each Track's candidacy for the enricher.

    With `track_ids`, those Tracks that exist; otherwise every Track with a Source the
    enricher can read: a Bilibili Source or a Library file.
    """
    sources = _sources(db, track_ids)
    ids = set(sources)
    if track_ids is not None:
        ids = {
            TrackId(i) for i in db.scalars(select(TrackRow.id).where(TrackRow.id.in_(track_ids)))
        }
    segments = set(db.scalars(select(SegmentRow.track_id)))
    albums = set(album_file_of(db).values())
    if enricher.subject is Subject.VIDEO:
        subjects = {track_id: video_id_of(sources.get(track_id, [])) for track_id in ids}
        videos = subjects
        came_from = _text_came_from(db)
    elif enricher.subject is Subject.TEXT:
        came_from = _text_came_from(db)
        subjects = {
            track_id: text_subject(track_id) if track_id in came_from else None for track_id in ids
        }
        videos = dict.fromkeys(ids)
    else:
        words = _words(db, ids)
        subjects = {
            track_id: _key(words, track_id, whole_album=track_id in albums) for track_id in ids
        }
        videos = dict.fromkeys(ids)
        came_from = {}
    asked = _asked(db, enricher.name)
    found: dict[TrackId, Candidate] = {}
    for track_id, subject in subjects.items():
        facts = TrackFacts(
            subject=subject,
            is_segment=track_id in segments,
            text_came_from=came_from.get(track_id),
            asked_at=None if subject is None else asked.get(subject),
        )
        file_name = _file_name(sources.get(track_id, []))
        found[track_id] = Candidate(facts, file_name, videos[track_id], track_id in albums)
    return found


def _key(words: dict[TrackId, OriginValues], track_id: TrackId, *, whole_album: bool) -> str | None:
    terms = search_terms(words.get(track_id, {}), whole_album=whole_album)
    return None if terms is None else terms.key(track_id)


def _sources(
    db: Session, track_ids: Sequence[TrackId] | None
) -> dict[TrackId, list[tuple[str, str]]]:
    named = select(SourceRow.track_id, SourceRow.kind, SourceRow.locator).where(
        SourceRow.kind.in_((BILIBILI_SOURCE, LIBRARY_SOURCE))
    )
    if track_ids is not None:
        named = named.where(SourceRow.track_id.in_(track_ids))
    sources: defaultdict[TrackId, list[tuple[str, str]]] = defaultdict(list)
    for track_id, kind, locator in db.execute(named):
        sources[TrackId(track_id)].append((kind, locator))
    return sources


def _text_came_from(db: Session) -> dict[TrackId, str]:
    rows = db.execute(select(VideoTextRow.track_id, VideoTextRow.came_from))
    return {TrackId(track_id): source for track_id, source in rows}


def _asked(db: Session, enricher: str) -> dict[str, datetime]:
    rows = db.execute(
        select(EnricherAskRow.subject, EnricherAskRow.asked_at).where(
            EnricherAskRow.enricher == enricher
        )
    )
    return {subject: at for subject, at in rows}  # noqa: C416 -- rows are not pairs to mypy


def _words(db: Session, track_ids: set[TrackId]) -> dict[TrackId, OriginValues]:
    """Return the title, artist, album, and album artist each origin gives each Track."""
    rows = db.execute(
        select(
            TrackValueRow.track_id, TrackValueRow.origin, TrackValueRow.field, TrackValueRow.value
        ).where(TrackValueRow.field.in_([str(field) for field in _WORDS]))
    )
    found: dict[TrackId, OriginValues] = {}
    for track_id, origin, field, value in rows:
        if track_id in track_ids:
            found.setdefault(TrackId(track_id), {}).setdefault(Origin(origin), {})[Field(field)] = (
                value
            )
    return found


def _file_name(sources: Sequence[tuple[str, str]]) -> str:
    """Return the name of the Library file among a Track's Sources, or empty."""
    for kind, locator in sources:
        if kind == LIBRARY_SOURCE:
            return PurePosixPath(path_of_locator(locator)).name
    return ""
