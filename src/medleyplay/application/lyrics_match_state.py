"""Active Auto-Match Jobs, shared by the services that may supersede them."""

from typing import Final

from sqlalchemy import select
from sqlalchemy.orm import Session

from medleyplay.application.jobs import JobService
from medleyplay.domain.catalog import TrackId
from medleyplay.domain.errors import ConflictError
from medleyplay.domain.jobs import ACTIVE_STATES, JobId
from medleyplay.persistence.schema import JobRow

MATCH_FIND: Final = "auto_match_find"
MATCH_CHOOSE: Final = "auto_match_choose"
MATCH_KINDS: Final = (MATCH_FIND, MATCH_CHOOSE)
LYRICS_CHANGED: Final = "lyrics_changed"
MATCH_BUSY: Final = "Auto-Match is working on this song."


class LyricsMatchInProgressError(ConflictError):
    """A regular lyrics lookup must wait until the song's Auto-Match ends."""

    code = "lyrics_match_in_progress"


def match_target(track_id: TrackId) -> str:
    """Return the common target for both stages of a song's Auto-Match."""
    return f"lyrics-match:{track_id}"


def active_match(db: Session, track_id: TrackId) -> JobRow | None:
    """Return the active Auto-Match stage, if any."""
    return db.scalar(
        select(JobRow)
        .where(
            JobRow.kind.in_(MATCH_KINDS),
            JobRow.target == match_target(track_id),
            JobRow.state.in_(ACTIVE_STATES),
        )
        .limit(1)
    )


def require_no_active_match(db: Session, track_id: TrackId) -> None:
    """Keep a different lookup from competing with an active Auto-Match."""
    if active_match(db, track_id) is not None:
        raise ConflictError(MATCH_BUSY)


def supersede_match(db: Session, jobs: JobService | None, track_id: TrackId) -> JobId | None:
    """Cancel a match in the transaction that changes the song's lyrics or search."""
    if jobs is None or (row := active_match(db, track_id)) is None:
        return None
    return jobs.cancel_active_in(db, row.kind, row.target, reason=LYRICS_CHANGED)
