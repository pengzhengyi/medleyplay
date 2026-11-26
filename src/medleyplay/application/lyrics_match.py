"""Auto-Match jobs find and stage lyrics picks for unchanged saved songs."""

from collections.abc import Sequence
from dataclasses import dataclass, replace
from functools import partial
from typing import Final, Literal

from pydantic import Field
from sqlalchemy import func, select, tuple_
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application import Clock
from medleyplay.application.details import songs_of
from medleyplay.application.enrichment import ENRICH_KIND, enrich_target
from medleyplay.application.jobs import JobCompletion, JobService, queue_job_in, to_job
from medleyplay.application.lyrics_match_picks import PICK_CHANGED, ready_picks
from medleyplay.application.lyrics_match_state import (
    LYRICS_CHANGED,
    MATCH_CHOOSE,
    MATCH_FIND,
    MATCH_KINDS,
    active_match,
    discard_pending_pick,
    match_target,
)
from medleyplay.application.lyrics_search import (
    CHOOSE_LYRICS_KIND,
    FIND_LYRICS_KIND,
    ChooseLyricsKind,
    FindLyricsKind,
    LyricsSearchKinds,
    choice_request,
    choose_lyrics_target,
    find_lyrics_target,
    require_empty,
    require_match_providers,
    require_matching,
    require_same_search,
    store_choice,
    store_search,
    validate_match_in,
)
from medleyplay.application.plugins import PluginService
from medleyplay.application.settings import read_settings
from medleyplay.domain.accounts import Account
from medleyplay.domain.catalog import TrackId
from medleyplay.domain.enrichers import LYRICS
from medleyplay.domain.errors import ConflictError, InvalidInputError, NotFoundError
from medleyplay.domain.jobs import ACTIVE_STATES, Job, JobId, JobState, failure_shown_to
from medleyplay.domain.lyrics import LyricsOrigin
from medleyplay.persistence.schema import (
    JobRow,
    LyricsSearchRow,
    SegmentRow,
    TrackLyricsRow,
    TrackRow,
)
from medleyplay.plugin_api import MAX_NAME, LyricsProvider
from medleyplay.programs.find_lyrics import (
    ChooseLyricsJob,
    ChosenLyricsResult,
    FindLyricsJob,
    FoundLyricsResult,
    MatchSong,
)

SKIPPED: Final = "match_skipped"
CHANGED: Final = "The saved song changed. Nothing was saved."
TRY_AGAIN: Final = "Start Auto-Match again from Songs."

type MatchState = Literal[
    "searching", "choosing", "waiting", "ready", "saved", "selected", "skipped", "failed"
]


class MatchSongInput(MatchSong):
    """The saved song and its row as they appear in Songs when Auto-Match is requested."""

    track_id: int = Field(ge=1)


@dataclass(frozen=True)
class MatchStatus:
    """A song's Auto-Match outcome, or why no Job was queued for it."""

    track_id: TrackId
    job_id: JobId | None
    state: MatchState
    note: str = ""
    previous_job_id: JobId | None = None
    """For a submission skip, the newest run that already existed when it was returned."""
    choice_job_id: JobId | None = None
    """The exact ready pick Songs Save may confirm."""


def lyrics_match_kinds(
    clock: Clock, search: LyricsSearchKinds, plugins: PluginService
) -> LyricsSearchKinds:
    """Use the existing programs and lanes, with completions that advance Auto-Match."""
    choose = replace(
        search.choose,
        name=MATCH_CHOOSE,
        complete=partial(_choose, clock=clock, plugins=plugins),
        on_submit=None,
        retry_refused=TRY_AGAIN,
    )
    find = replace(
        search.find,
        name=MATCH_FIND,
        complete=partial(_find, choose=choose, clock=clock, plugins=plugins),
        on_submit=None,
        retry_refused=TRY_AGAIN,
    )
    return LyricsSearchKinds(find, choose)


class LyricsMatchService:
    """Queue and read Auto-Match for one or more saved songs of an album."""

    def __init__(
        self,
        units: sessionmaker[Session],
        plugins: PluginService,
        jobs: JobService,
        kind: FindLyricsKind,
    ) -> None:
        """Create the service over the database and the server's Job Runner."""
        self._units, self._plugins, self._jobs, self._kind = units, plugins, jobs, kind

    def start(
        self, caller: Account, album: TrackId, songs: Sequence[MatchSongInput]
    ) -> tuple[MatchStatus, ...]:
        """Accept each distinct song once; do not attach to an incompatible active Job."""
        asked: dict[int, MatchSongInput] = {}
        for song in songs:
            previous = asked.setdefault(song.track_id, song)
            if previous != song:
                message = "Each song can have only one saved row for Auto-Match."
                raise InvalidInputError(message)
        queued: list[JobId] = []
        with self._units.begin() as db:
            db.connection().exec_driver_sql("BEGIN IMMEDIATE")
            require_matching(db, self._jobs, self._plugins)
            if db.get(TrackRow, album) is None:
                message = "There is no such album."
                raise NotFoundError(message)
            saved = {row.track_id: row for row in songs_of(db, album)}
            sites = tuple(LyricsProvider(site.value) for site in read_settings(db).lyrics_sites)
            results = tuple(
                self._start_song(db, caller, song, saved.get(song.track_id), sites, queued)
                for song in asked.values()
            )
        self._jobs.announce_queued(*queued)
        return results

    def _start_song(
        self,
        db: Session,
        caller: Account,
        song: MatchSongInput,
        segment: SegmentRow | None,
        sites: tuple[LyricsProvider, ...],
        queued: list[JobId],
    ) -> MatchStatus:
        track_id = TrackId(song.track_id)
        try:
            request = _request(db, song, segment, sites)
        except ConflictError as error:
            return _submission_skip(db, track_id, str(error))
        if (active := active_match(db, track_id)) is not None:
            root = _search_row(db, active)
            if root is not None and FindLyricsJob.model_validate(root.request) == request:
                return _status(caller, track_id, active, online=True)
            note = "Auto-Match is working on an earlier version of this song."
            return _submission_skip(db, track_id, note)
        if _other_lyrics_job(db, track_id):
            note = "The song's lyrics are already being looked up."
            return _submission_skip(db, track_id, note)
        job, inserted = self._jobs.submit_in(
            db, self._kind, match_target(track_id), request, caller.id
        )
        if inserted:
            discard_pending_pick(db, track_id)
            queued.append(job.id)
        return MatchStatus(track_id, job.id, "searching")

    def status(self, viewer: Account, album: TrackId) -> tuple[MatchStatus, ...]:
        """Read manual lyrics selections and the remaining songs' Auto-Match outcomes."""
        with self._units() as db:
            if db.get(TrackRow, album) is None:
                message = "There is no such album."
                raise NotFoundError(message)
            songs = songs_of(db, album)
            selected = set(
                db.scalars(
                    select(TrackLyricsRow.track_id).where(
                        TrackLyricsRow.track_id.in_(song.track_id for song in songs),
                        TrackLyricsRow.origin == LyricsOrigin.HOUSEHOLD,
                        ~TrackLyricsRow.dismissed,
                    )
                )
            )
            ids = (
                select(func.max(JobRow.id))
                .where(
                    JobRow.kind.in_(MATCH_KINDS),
                    JobRow.target.in_(match_target(TrackId(s.track_id)) for s in songs),
                )
                .group_by(JobRow.target)
            )
            latest = {
                row.target: row for row in db.scalars(select(JobRow).where(JobRow.id.in_(ids)))
            }
            shown: list[MatchStatus] = []
            online = self._jobs.online()
            for song in songs:
                track_id = TrackId(song.track_id)
                if track_id in selected:
                    shown.append(MatchStatus(track_id, None, "selected"))
                    continue
                row = latest.get(match_target(track_id))
                if row is not None and _is_for_segment(db, row, song.id):
                    status = _status(viewer, track_id, row, online=online)
                    shown.append(
                        _pick_status(db, album, row, status) if status.state == "ready" else status
                    )
            return tuple(shown)


def _request(
    db: Session,
    song: MatchSongInput,
    segment: SegmentRow | None,
    sites: tuple[LyricsProvider, ...],
) -> FindLyricsJob:
    track = db.get(TrackRow, song.track_id)
    if track is None or segment is None or segment.id != song.segment_id:
        raise ConflictError(CHANGED)
    title, artist = track.title.strip(), track.artist.strip()
    if not title or len(title) > MAX_NAME or len(artist) > MAX_NAME:
        message = "The song needs a title and a supported title and artist length."
        raise ConflictError(message)
    request = FindLyricsJob(
        track_id=track.id,
        title=title,
        artist=artist,
        duration_ms=track.duration_ms,
        sites=sites,
        match=MatchSong.model_validate(song.model_dump(exclude={"track_id"})),
        match_album=track.album,
    )
    require_same_search(db, track, request)
    require_empty(db, TrackId(track.id))
    return request


def _other_lyrics_job(db: Session, track_id: TrackId) -> bool:
    return (
        db.scalar(
            select(JobRow.id)
            .where(
                JobRow.state.in_(ACTIVE_STATES),
                tuple_(JobRow.kind, JobRow.target).in_(
                    (
                        (FIND_LYRICS_KIND, find_lyrics_target(track_id)),
                        (CHOOSE_LYRICS_KIND, choose_lyrics_target(track_id)),
                        (ENRICH_KIND, enrich_target(track_id, LYRICS.name)),
                    )
                ),
            )
            .limit(1)
        )
        is not None
    )


def _search_row(db: Session, row: JobRow) -> JobRow | None:
    if row.kind == MATCH_FIND:
        return row
    previous = ChooseLyricsJob.model_validate(row.request).search_job
    return None if previous is None else db.get(JobRow, previous)


def _submission_skip(db: Session, track_id: TrackId, note: str) -> MatchStatus:
    previous = db.scalar(
        select(func.max(JobRow.id)).where(
            JobRow.kind == MATCH_FIND, JobRow.target == match_target(track_id)
        )
    )
    return MatchStatus(
        track_id,
        None,
        "skipped",
        note,
        previous_job_id=None if previous is None else JobId(previous),
    )


def _is_for_segment(db: Session, row: JobRow, segment_id: int) -> bool:
    root = _search_row(db, row)
    if root is None:
        return False
    saved = FindLyricsJob.model_validate(root.request).match
    return saved is not None and saved.segment_id == segment_id


def _status(viewer: Account, track_id: TrackId, row: JobRow, *, online: bool) -> MatchStatus:
    job = to_job(row)
    if job.kind == MATCH_CHOOSE:
        search_job = ChooseLyricsJob.model_validate(row.request).search_job
        job_id = job.id if search_job is None else JobId(search_job)
    else:
        job_id = job.id
    if job.state.is_active:
        if not online or job.state is JobState.WAITING:
            return MatchStatus(track_id, job_id, "waiting")
        return MatchStatus(track_id, job_id, "searching" if job.kind == MATCH_FIND else "choosing")
    if job.kind == MATCH_CHOOSE and job.state is JobState.SUCCEEDED:
        return MatchStatus(track_id, job_id, "ready")
    if job.failure_kind == SKIPPED:
        return MatchStatus(track_id, job_id, "skipped", job.failure_message)
    if job.state is JobState.CANCELLED:
        note = (
            "The lyrics or their search changed. Nothing was saved."
            if job.failure_kind == LYRICS_CHANGED
            else "Auto-Match was cancelled."
        )
        return MatchStatus(track_id, job_id, "skipped", note)
    return MatchStatus(track_id, job_id, "failed", failure_shown_to(job, viewer))


def _pick_status(db: Session, album: TrackId, choice: JobRow, status: MatchStatus) -> MatchStatus:
    search = db.get(LyricsSearchRow, status.track_id)
    if search is None or search.match_choice_job_id != choice.id:
        return replace(status, state="skipped", note="No pending lyric pick.")
    if search.match_confirmed:
        return replace(status, state="saved")
    try:
        ready_picks(db, album, (JobId(choice.id),))
    except ConflictError:
        return replace(status, state="skipped", note=PICK_CHANGED)
    return replace(status, choice_job_id=JobId(choice.id))


def _eligible(db: Session, request: FindLyricsJob) -> TrackRow:
    track_id = TrackId(request.track_id)
    track = db.get(TrackRow, track_id)
    if track is None:
        raise ConflictError(CHANGED)
    require_same_search(db, track, request)
    require_empty(db, track_id)
    return track


def _skipped(message: str) -> JobCompletion:
    return JobCompletion(failure=(SKIPPED, message))


def _find(
    db: Session,
    job: Job,
    found: FoundLyricsResult,
    *,
    choose: ChooseLyricsKind,
    clock: Clock,
    plugins: PluginService,
) -> JobCompletion:
    request = FindLyricsJob.model_validate(db.get_one(JobRow, job.id).request)
    try:
        track = _eligible(db, request)
        require_match_providers(db, plugins)
    except ConflictError as error:
        return _skipped(str(error))
    if (found.track_id, found.title, found.artist) != (track.id, request.title, request.artist):
        return _skipped(CHANGED)
    row = store_search(db, found, clock)
    if row is None or not found.options:
        return _skipped("No candidates found.")
    next_job = queue_job_in(
        db,
        choose,
        job.target,
        choice_request(track, row, found.options, job.id),
        job.requested_by,
        clock,
    )
    return JobCompletion(queued=(next_job.id,))


def _choose(
    db: Session, job: Job, chosen: ChosenLyricsResult, *, clock: Clock, plugins: PluginService
) -> JobCompletion | None:
    current = db.get_one(JobRow, job.id)
    asked = ChooseLyricsJob.model_validate(current.request)
    root = _search_row(db, current)
    row = db.get(LyricsSearchRow, asked.track_id)
    if (
        root is None
        or root.kind != MATCH_FIND
        or root.target != job.target
        or root.state != JobState.SUCCEEDED
        or row is None
        or row.track_id != chosen.track_id
    ):
        return _skipped(CHANGED)
    request = FindLyricsJob.model_validate(root.request)
    try:
        _eligible(db, request)
        require_match_providers(db, plugins)
        at = store_choice(db, row, chosen, clock)
        if at is None:
            return _skipped(CHANGED)
        if chosen.option is None:
            return _skipped("No clear match.")
        validate_match_in(db, request, asked, row)
        row.match_choice_job_id = job.id
        row.match_confirmed = False
    except (ConflictError, InvalidInputError) as error:
        return _skipped(str(error))
    return None
