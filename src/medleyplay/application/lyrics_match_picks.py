"""Validate and confirm the exact Auto-Match picks named by Songs Save."""

from collections.abc import Collection
from dataclasses import dataclass
from datetime import datetime
from typing import Final

from sqlalchemy.orm import Session

from medleyplay.application.lyrics import record_lyrics
from medleyplay.application.lyrics_match_state import MATCH_CHOOSE, MATCH_FIND, match_target
from medleyplay.application.lyrics_search import validate_match_in
from medleyplay.domain.catalog import TrackId
from medleyplay.domain.errors import ConflictError
from medleyplay.domain.jobs import JobId, JobState
from medleyplay.domain.lyrics import LyricsOrigin
from medleyplay.persistence.schema import JobRow, LyricsSearchRow, SegmentRow, SourceRow
from medleyplay.plugin_api import LyricsOption
from medleyplay.programs.find_lyrics import ChooseLyricsJob, FindLyricsJob

PICK_CHANGED: Final = "A lyric pick or its song changed. Review the current picks and save again."


@dataclass(frozen=True)
class ReadyPick:
    """A checked lyrics pick in the Songs write transaction."""

    search: LyricsSearchRow
    option: LyricsOption

    def confirm(self, db: Session, now: datetime) -> TrackId:
        """Keep this site's lyrics and mark the pick confirmed."""
        track_id = TrackId(self.search.track_id)
        record_lyrics(
            db,
            track_id,
            LyricsOrigin(self.option.provider.value),
            self.option.text,
            now,
            instrumental=self.option.instrumental,
        )
        self.search.match_confirmed = True
        return track_id


def ready_picks(
    db: Session, album: TrackId, choice_ids: Collection[JobId]
) -> tuple[ReadyPick, ...]:
    """Require each choice to be the pending pick of an unchanged song of this album."""
    return tuple(_ready_pick(db, album, job_id) for job_id in dict.fromkeys(choice_ids))


def _ready_pick(db: Session, album: TrackId, job_id: JobId) -> ReadyPick:
    choice = db.get(JobRow, job_id)
    if choice is None or choice.kind != MATCH_CHOOSE or choice.state != JobState.SUCCEEDED:
        raise ConflictError(PICK_CHANGED)
    asked = ChooseLyricsJob.model_validate(choice.request)
    search = db.get(LyricsSearchRow, asked.track_id)
    root = None if asked.search_job is None else db.get(JobRow, asked.search_job)
    if (
        search is None
        or search.match_choice_job_id != job_id
        or search.match_confirmed
        or root is None
        or root.kind != MATCH_FIND
        or root.state != JobState.SUCCEEDED
        or root.target != choice.target
        or choice.target != match_target(TrackId(asked.track_id))
    ):
        raise ConflictError(PICK_CHANGED)
    request = FindLyricsJob.model_validate(root.request)
    segment = None if request.match is None else db.get(SegmentRow, request.match.segment_id)
    source = None if segment is None else db.get(SourceRow, segment.album_source_id)
    if source is None or source.track_id != album or request.track_id != asked.track_id:
        raise ConflictError(PICK_CHANGED)
    try:
        option = validate_match_in(db, request, asked, search)
    except ConflictError as error:
        raise ConflictError(PICK_CHANGED) from error
    return ReadyPick(search, option)
