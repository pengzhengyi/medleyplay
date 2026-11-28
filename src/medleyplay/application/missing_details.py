"""List, request, and accept missing music details under the catalog's write lock."""

from dataclasses import dataclass
from typing import ClassVar, Final, Literal

from sqlalchemy import ColumnElement, Select, and_, or_, select
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application import Clock
from medleyplay.application.ai import is_set_up
from medleyplay.application.catalog import dismissed_download_tracks
from medleyplay.application.changes import OnChange
from medleyplay.application.details import set_household
from medleyplay.application.jobs import JobKind, JobService, Lane
from medleyplay.application.missing_detail_candidates import (
    CreditCandidate,
    DetailImpact,
    MissingTrack,
    library_candidates,
    missing_track,
)
from medleyplay.application.plugins import PluginService
from medleyplay.application.settings import read_settings
from medleyplay.domain.accounts import Account
from medleyplay.domain.catalog import TrackId
from medleyplay.domain.details import Field, Kind, Origin
from medleyplay.domain.enrichers import AI_DETAILS
from medleyplay.domain.errors import ConflictError, NotFoundError
from medleyplay.domain.jobs import ACTIVE_STATES, Job, JobState
from medleyplay.persistence.schema import JobRow, MissingDetailsRow, TrackRow, TrackValueRow
from medleyplay.plugin_api.missing_details import (
    MISSING_DETAILS_SUGGESTER,
    MissingField,
    SuggestedMissingDetails,
)
from medleyplay.programs.missing_details import MissingDetailsJob

MISSING_DETAILS_KIND: Final = "suggest_missing_details"
PAGE_SIZE: Final = 24
_CHANGED: Final = "The Track or suggestion changed. Review the current details."
_DISABLED: Final = "Missing-details AI is off in Settings."
type MissingDetailsKind = JobKind[MissingDetailsJob, SuggestedMissingDetails]
type AiState = Literal[
    "off", "unavailable", "no_metadata", "ready", "working", "failed", "answered"
]


@dataclass(frozen=True)
class MissingDetail:
    """One field to fill or leave blank, with any current candidates."""

    field: MissingField
    candidates: tuple[CreditCandidate, ...]


@dataclass(frozen=True)
class MissingDetailsItem:
    """A Track to review, its current key, and the state of its AI request."""

    track_id: int
    title: str
    artist: str
    album: str
    kind: Kind
    key: str
    fields: tuple[MissingDetail, ...]
    ai: AiState


@dataclass(frozen=True)
class MissingDetailsPage:
    """A page in stable Track ID order, with the cursor for the next page."""

    tracks: tuple[MissingDetailsItem, ...]
    next_after: int | None


@dataclass(frozen=True)
class DetailDecision:
    """A reviewed candidate, or an intentional blank when `candidate` is absent."""

    key: str
    field: MissingField
    candidate: CreditCandidate | None = None


class DetailReviewRequiredError(ConflictError):
    """Stop a one-field save and return the impact for review in Edit details."""

    code: ClassVar[str] = "missing_detail_review_required"

    def __init__(self, impact: DetailImpact) -> None:
        """Keep the effects of the refused save."""
        super().__init__("This change also affects other details or songs. Use Edit details.")
        self.impact = impact


class MissingDetailsService:
    """Keep Clean up's suggestions separate from the Library's shown values."""

    def __init__(
        self,
        units: sessionmaker[Session],
        clock: Clock,
        jobs: JobService,
        plugins: PluginService,
        on_change: OnChange | None = None,
    ) -> None:
        """Use the shared Job runner and announce catalog changes only after saving."""
        self._units, self._clock, self._jobs = units, clock, jobs
        self._plugins, self._on_change = plugins, on_change

    def list(self, after: int = 0) -> MissingDetailsPage:
        """Read a page without scheduling or contacting an AI provider."""
        with self._units() as db:
            db.connection().exec_driver_sql("BEGIN")
            enabled = read_settings(db).suggest_missing_details_by_ai
            available = enabled and is_set_up(db) and self._available()
            dismissed = dismissed_download_tracks(db)
            items: list[MissingDetailsItem] = []
            for row in db.scalars(_eligible_rows(after)):
                if row.id in dismissed:
                    continue
                item = missing_track(db, row)
                if item is None:
                    continue
                if len(items) == PAGE_SIZE:
                    return MissingDetailsPage(tuple(items), items[-1].track_id)
                items.append(_item(db, item, dismissed, enabled=enabled, available=available))
            return MissingDetailsPage(tuple(items), None)

    def ask(self, caller: Account, track_id: TrackId, key: str) -> Job:
        """Queue this revision, or reuse its existing active Job."""
        with self._units.begin() as db:
            db.connection().exec_driver_sql("BEGIN IMMEDIATE")
            if not read_settings(db).suggest_missing_details_by_ai:
                raise ConflictError(_DISABLED)
            if not (is_set_up(db) and self._available()):
                message = "Set up an AI provider in Settings first."
                raise ConflictError(message)
            track = _reviewed(db, track_id, key, dismissed_download_tracks(db))
            if (clues := track.clues()) is None:
                message = "There is not enough named music metadata to ask AI."
                raise ConflictError(message)
            target = _target(track_id)
            active = _latest(db, track_id, active_only=True)
            if active is not None and active.request.get("key") != key:
                message = "AI is working on an earlier version of this Track."
                raise ConflictError(message)
            request = MissingDetailsJob(track_id=track_id, key=key, clues=clues)
            job, inserted = self._jobs.submit_in(
                db, MISSING_DETAILS_JOB, target, request, caller.id
            )
        if inserted:
            self._jobs.announce_queued(job.id)
        return job

    def decide(self, track_id: TrackId, decision: DetailDecision) -> None:
        """Write one household override after checking current evidence and side effects."""
        with self._units.begin() as db:
            db.connection().exec_driver_sql("BEGIN IMMEDIATE")
            dismissed = dismissed_download_tracks(db)
            track = _reviewed(db, track_id, decision.key, dismissed)
            if decision.field not in track.fields:
                raise ConflictError(_CHANGED)
            value = ""
            if decision.candidate is not None:
                enabled = read_settings(db).suggest_missing_details_by_ai
                if (
                    decision.candidate
                    not in _choices(db, track, dismissed, enabled=enabled)[decision.field]
                ):
                    raise ConflictError(_CHANGED)
                value = decision.candidate.value
            field = Field(decision.field)
            if (impact := track.review_impact(db, field, value)) is not None:
                raise DetailReviewRequiredError(impact)
            set_household(db, track_id, {field: value}, self._clock())
        if self._on_change is not None:
            self._on_change("catalog")

    def _available(self) -> bool:
        return AI_DETAILS.name in self._plugins.available_keys().get(
            MISSING_DETAILS_SUGGESTER.name, []
        )


def _eligible_rows(after: int) -> Select[TrackRow]:
    def open_field(field: Field) -> ColumnElement[bool]:
        return (
            ~select(TrackValueRow.track_id)
            .where(
                TrackValueRow.track_id == TrackRow.id,
                TrackValueRow.field == field,
                TrackValueRow.origin == Origin.HOUSEHOLD,
            )
            .exists()
        )

    album = and_(TrackRow.album == "", open_field(Field.ALBUM))
    artist = and_(
        TrackRow.artist == "",
        or_(
            open_field(Field.ARTIST),
            and_(TrackRow.album_artist == "", open_field(Field.ALBUM_ARTIST)),
        ),
    )
    return (
        select(TrackRow)
        .where(TrackRow.id > after, or_(album, artist))
        .order_by(TrackRow.id)
        .execution_options(yield_per=PAGE_SIZE)
    )


def _item(
    db: Session, track: MissingTrack, dismissed: set[int], *, enabled: bool, available: bool
) -> MissingDetailsItem:
    choices = _choices(db, track, dismissed, enabled=enabled)
    row = track.track
    return MissingDetailsItem(
        track_id=row.id,
        title=row.title,
        artist=(row.album_artist or row.artist) if track.kind is Kind.ALBUM else row.artist,
        album=row.album,
        kind=track.kind,
        key=track.key,
        fields=tuple(MissingDetail(field, choices[field]) for field in track.fields),
        ai=_status(db, track, enabled=enabled, available=available),
    )


def _status(db: Session, track: MissingTrack, *, enabled: bool, available: bool) -> AiState:
    if not enabled:
        return "off"
    if not available:
        return "unavailable"
    if track.clues() is None:
        return "no_metadata"
    latest = _latest(db, TrackId(track.track.id))
    if latest is not None and latest.state in ACTIVE_STATES:
        return "working"
    if (
        latest is not None
        and latest.state == JobState.FAILED
        and latest.request.get("key") == track.key
    ):
        return "failed"
    return "answered" if _stored(db, track) is not None else "ready"


def _choices(
    db: Session, track: MissingTrack, dismissed: set[int], *, enabled: bool
) -> dict[MissingField, tuple[CreditCandidate, ...]]:
    local = library_candidates(db, track, dismissed)
    stored = _stored(db, track) if enabled else None
    choices: dict[MissingField, tuple[CreditCandidate, ...]] = {}
    for field in track.fields:
        candidates = local if field == "album" else ()
        value = None if stored is None else stored.values.get(field)
        if value and not any(each.value.casefold() == value.casefold() for each in candidates):
            candidates = (*candidates, CreditCandidate(value, "ai"))
        choices[field] = candidates
    return choices


def _stored(db: Session, track: MissingTrack) -> MissingDetailsRow | None:
    row = db.get(MissingDetailsRow, track.track.id)
    return row if row is not None and row.key == track.key else None


def _latest(db: Session, track_id: TrackId, *, active_only: bool = False) -> JobRow | None:
    query = select(JobRow).where(
        JobRow.kind == MISSING_DETAILS_KIND, JobRow.target == _target(track_id)
    )
    if active_only:
        query = query.where(JobRow.state.in_(ACTIVE_STATES))
    return db.scalar(query.order_by(JobRow.id.desc()).limit(1))


def _target(track_id: TrackId) -> str:
    return f"track:{track_id}"


def _reviewed(db: Session, track_id: TrackId, key: str, dismissed: set[int]) -> MissingTrack:
    row = db.get(TrackRow, track_id)
    if row is None:
        message = "The Track is no longer in the Library."
        raise NotFoundError(message)
    track = None if track_id in dismissed else missing_track(db, row)
    if track is None or track.key != key:
        raise ConflictError(_CHANGED)
    return track


def _refuse_start(db: Session, raw: object) -> str | None:
    if not read_settings(db).suggest_missing_details_by_ai:
        return _DISABLED
    if not is_set_up(db):
        return "Set up an AI provider in Settings first."
    request = MissingDetailsJob.model_validate(raw)
    try:
        found = _reviewed(db, TrackId(request.track_id), request.key, dismissed_download_tracks(db))
    except (ConflictError, NotFoundError) as error:
        return str(error)
    return None if found.clues() == request.clues else _CHANGED


def _complete(db: Session, job: Job, found: SuggestedMissingDetails) -> None:
    raw = db.get_one(JobRow, job.id).request
    if _refuse_start(db, raw) is not None:
        return
    request = MissingDetailsJob.model_validate(raw)
    db.merge(
        MissingDetailsRow(track_id=request.track_id, key=request.key, values=dict(found.values))
    )


MISSING_DETAILS_JOB: Final[MissingDetailsKind] = JobKind(
    name=MISSING_DETAILS_KIND,
    program="medleyplay.programs.missing_details:MISSING_DETAILS_PROGRAM",
    request=MissingDetailsJob,
    result=SuggestedMissingDetails,
    points=(MISSING_DETAILS_SUGGESTER.name,),
    lane_field="lane",
    lanes={
        AI_DETAILS.name: Lane(spacing=AI_DETAILS.spacing, lends_ai=True, shared=AI_DETAILS.name)
    },
    needs_network=True,
    complete=_complete,
    refuse_start=_refuse_start,
    retry_refused="Ask again from Clean up to use the current Track details.",
)
