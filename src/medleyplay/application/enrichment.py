"""Enrichment: asking a site for the details a Track's file does not say, when someone asks.

Nothing here runs by itself. A Track is asked for when a person chooses *Find details
online* for it, or an admin chooses it for every Track that is eligible; each Track is
one Job, and the Jobs of an enricher run one at a time with a pause between them.
What the site says is recorded as the enricher's origin, and the first time the site
refuses a request the enricher stops until an admin resets it:

```text
Find details online     one Track          any Account
Find details for all    every eligible     an admin
Reset                   a stopped enricher an admin
```
"""

from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from functools import partial
from pathlib import Path, PurePosixPath
from typing import Final

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application import Clock, details
from medleyplay.application.jobs import JobKind, JobService, Lane
from medleyplay.application.plugins import PluginService
from medleyplay.application.scan_covers import NotACoverError, keep_copy
from medleyplay.domain.accounts import Account
from medleyplay.domain.catalog import TrackId
from medleyplay.domain.details import Field, Shown, check_values, shown
from medleyplay.domain.enrichers import (
    ENRICHERS,
    MESSAGES,
    Enricher,
    Ineligible,
    TrackFacts,
    enricher_named,
    video_id_of,
    why_not,
)
from medleyplay.domain.errors import (
    ConflictError,
    ForbiddenError,
    NotFoundError,
    PluginUnavailableError,
)
from medleyplay.domain.jobs import Job, JobId, JobState
from medleyplay.domain.libraries import LIBRARY_SOURCE, path_of_locator
from medleyplay.domain.links import BILIBILI_SOURCE
from medleyplay.domain.video_text import Chapter, VideoText
from medleyplay.persistence.schema import (
    EnricherStopRow,
    JobRow,
    SegmentRow,
    SourceRow,
    TrackRow,
    VideoAskRow,
    VideoTextRow,
)
from medleyplay.plugin_api import TRACK_ENRICHER, ShownDetail
from medleyplay.plugin_api import VideoText as AnsweredText
from medleyplay.programs.enrich_track import EnrichedTrack, EnrichJob
from medleyplay.programs.info_json import MAX_START_MS

ENRICH_KIND: Final = "enrich_track"
SITE_TEXT: Final = "site"
"""Where the video's text came from when an enricher read it from a site."""

type EnrichKind = JobKind[EnrichJob, EnrichedTrack]


def enrich_target(track_id: TrackId) -> str:
    """Return the target of the Job that asks about the Track."""
    return f"track:{track_id}"


@dataclass(frozen=True)
class EnricherState:
    """Whether an enricher can be asked, and why not when the site refused it."""

    name: str
    available: bool
    """Its plugin is on."""
    stopped_at: datetime | None
    reason: str
    """The site's refusal that stopped it, or empty."""


@dataclass(frozen=True)
class _Candidate:
    facts: TrackFacts
    file_name: str


def enrich_track_kind(covers_folder: Path, clock: Clock) -> EnrichKind:
    """Return the Job kind that asks an enricher about one Track and records what it finds.

    The cover it finds is kept in `covers_folder`, as a scan keeps the covers it finds.
    """
    return JobKind(
        name=ENRICH_KIND,
        program="medleyplay.programs.enrich_track:ENRICH_TRACK_PROGRAM",
        request=EnrichJob,
        result=EnrichedTrack,
        complete=partial(_complete, clock=clock, covers_folder=covers_folder),
        points=(TRACK_ENRICHER.name,),
        needs_network=True,
        lane_field="enricher",
        lanes={
            each.name: Lane(spacing=each.spacing, proxy_site=each.site)
            for each in ENRICHERS.values()
        },
        refuse_start=_refuse_start,
        on_failure=partial(_on_failure, clock=clock),
    )


def _complete(
    db: Session, job: Job, found: EnrichedTrack, *, clock: Clock, covers_folder: Path
) -> None:
    """Note that the video was asked, and record what the site said unless the Track has moved on.

    A Track whose video text came from a file or the household since the Job was queued
    is left as it is.
    """
    enricher, now = enricher_named(found.enricher), clock()
    _record_ask(db, enricher.name, found.video, now)
    track_id = TrackId(int(job.target.removeprefix("track:")))
    if db.get(TrackRow, track_id) is None or _text_is_owned(db, track_id):
        return
    cover = _keep_cover(found, covers_folder)
    if found.video_text is not None:
        text = _read_text(found.video_text)
        if text is not None:
            details.record_video_text(db, track_id, text, SITE_TEXT, now, cover=cover)
        return
    values = dict(check_values(found.values))
    if cover is not None:
        values[Field.COVER] = cover
    if values:
        details.record(db, track_id, enricher.origin, values, now)


def _refuse_start(db: Session, request: object) -> str | None:
    name = _enricher_of(request)
    stop = None if name is None else db.get(EnricherStopRow, name)
    return None if stop is None else _stopped_message(stop.enricher, stop.reason)


def _on_failure(db: Session, job: Job, kind: str, message: str, *, clock: Clock) -> Sequence[JobId]:
    """Note that the site answered, and stop the enricher when it refused.

    A video that is gone counts as asked; a refusal also fails the enricher's Jobs
    that haven't started. Return those Jobs.
    """
    request = db.get_one(JobRow, job.id).request
    name, video = _enricher_of(request), request.get("video")
    if name is None or kind not in {"gone", "refused"}:
        return []
    now = clock()
    if isinstance(video, str):
        _record_ask(db, name, video, now)
    if kind != "refused":
        return []
    db.merge(EnricherStopRow(enricher=name, stopped_at=now, reason=message[:2048]))
    return _fail_queued(db, name, _stopped_message(name, message), now)


class EnrichmentService:
    """Ask enrichers about Tracks, say which Tracks they may be asked about, and reset them."""

    def __init__(
        self,
        units: sessionmaker[Session],
        clock: Clock,
        plugins: PluginService,
        jobs: JobService,
        kind: EnrichKind,
    ) -> None:
        """Create a service that queues its Jobs in `jobs`."""
        self._units = units
        self._clock = clock
        self._plugins = plugins
        self._jobs = jobs
        self._kind = kind

    def state(self, name: str) -> EnricherState:
        """Return whether the enricher can be asked, and whether the site stopped it."""
        enricher = enricher_named(name)
        with self._units() as db:
            stop = db.get(EnricherStopRow, enricher.name)
        return EnricherState(
            name=enricher.name,
            available=self._available(enricher),
            stopped_at=None if stop is None else stop.stopped_at,
            reason="" if stop is None else stop.reason,
        )

    def eligible(self, name: str) -> list[TrackId]:
        """Return the Tracks the enricher may be asked about now; none while it is stopped."""
        enricher = enricher_named(name)
        now = self._clock()
        with self._units() as db:
            if db.get(EnricherStopRow, enricher.name) is not None:
                return []
            candidates = _candidates(db, enricher.name, None)
        return [
            track_id
            for track_id, found in candidates.items()
            if why_not(found.facts, now, stopped=False) is None
        ]

    def find_details(self, caller: Account, track_id: TrackId, name: str) -> Job:
        """Queue asking the enricher about the Track, or return the Job already doing it.

        The Track must be eligible; the Job waits while the Mode is Offline.
        """
        enricher = enricher_named(name)
        self._require_available(enricher)
        now = self._clock()
        with self._units() as db:
            stopped = db.get(EnricherStopRow, enricher.name) is not None
            found = _candidates(db, enricher.name, [track_id]).get(track_id)
            if found is None:
                message = f"No Track has the id {track_id}."
                raise NotFoundError(message)
            shown_now = shown(details.values_of(db, track_id))
            duration_ms = db.scalar(select(TrackRow.duration_ms).where(TrackRow.id == track_id))
        reason = why_not(found.facts, now, stopped=stopped)
        if reason is not None:
            raise ConflictError(MESSAGES[reason])
        return self._jobs.submit(
            self._kind,
            enrich_target(track_id),
            _request(enricher, found, shown_now, duration_ms),
            caller.id,
        )

    def find_details_for_all(self, caller: Account, name: str) -> int:
        """Queue the enricher for every eligible Track; admins only. Return how many were queued.

        A Track that already has a Job waiting or running is not counted.
        """
        _require_admin(caller)
        enricher = enricher_named(name)
        self._require_available(enricher)
        if self.state(name).stopped_at is not None:
            raise ConflictError(MESSAGES[Ineligible.STOPPED])
        queued = 0
        for track_id in self.eligible(name):
            target = enrich_target(track_id)
            if self._jobs.active(ENRICH_KIND, target) is None:
                self.find_details(caller, track_id, name)
                queued += 1
        return queued

    def reset(self, caller: Account, name: str) -> None:
        """Let a stopped enricher be asked again; admins only. Resetting one that runs is fine."""
        _require_admin(caller)
        enricher = enricher_named(name)
        with self._units.begin() as db:
            stop = db.get(EnricherStopRow, enricher.name)
            if stop is not None:
                db.delete(stop)

    def _available(self, enricher: Enricher) -> bool:
        keys = self._plugins.available_keys().get(TRACK_ENRICHER.name, [])
        return enricher.name in keys

    def _require_available(self, enricher: Enricher) -> None:
        if not self._available(enricher):
            message = f"{enricher.name} is turned off."
            raise PluginUnavailableError(message)


def _candidates(
    db: Session, enricher: str, track_ids: Sequence[TrackId] | None
) -> dict[TrackId, _Candidate]:
    """Return what decides, for each Track, whether the enricher is asked about it.

    With `track_ids`, those Tracks that exist; otherwise every Track with a video.
    """
    named = select(SourceRow.track_id, SourceRow.kind, SourceRow.locator).where(
        SourceRow.kind.in_((BILIBILI_SOURCE, LIBRARY_SOURCE))
    )
    if track_ids is not None:
        named = named.where(SourceRow.track_id.in_(track_ids))
    sources: defaultdict[TrackId, list[tuple[str, str]]] = defaultdict(list)
    for track_id, kind, locator in db.execute(named):
        sources[TrackId(track_id)].append((kind, locator))
    ids = set(sources)
    if track_ids is not None:
        ids = {
            TrackId(i) for i in db.scalars(select(TrackRow.id).where(TrackRow.id.in_(track_ids)))
        }
    videos = {track_id: video_id_of(sources.get(track_id, [])) for track_id in ids}
    segments = set(db.scalars(select(SegmentRow.track_id)))
    text_rows = db.execute(select(VideoTextRow.track_id, VideoTextRow.came_from))
    came_from = {TrackId(track_id): source for track_id, source in text_rows}
    ask_rows = db.execute(
        select(VideoAskRow.video, VideoAskRow.asked_at).where(VideoAskRow.enricher == enricher)
    )
    asked = {video: at for video, at in ask_rows}  # noqa: C416 -- rows are not pairs to mypy
    found: dict[TrackId, _Candidate] = {}
    for track_id, video in videos.items():
        facts = TrackFacts(
            video=video,
            is_segment=track_id in segments,
            text_came_from=came_from.get(track_id),
            asked_at=None if video is None else asked.get(video),
        )
        found[track_id] = _Candidate(facts, _file_name(sources.get(track_id, [])))
    return found


def _file_name(sources: Sequence[tuple[str, str]]) -> str:
    """Return the name of the Library file among a Track's Sources, or empty."""
    for kind, locator in sources:
        if kind == LIBRARY_SOURCE:
            return PurePosixPath(path_of_locator(locator)).name
    return ""


def _request(
    enricher: Enricher, found: _Candidate, shown_now: Mapping[Field, Shown], duration_ms: int | None
) -> EnrichJob:
    video = found.facts.video
    if video is None:  # pragma: no cover -- an eligible Track has a video
        raise ValueError(video)
    return EnrichJob(
        enricher=enricher.name,
        video=video,
        shown=tuple(
            ShownDetail(field=str(field), value=each.value, origin=str(each.origin))
            for field, each in shown_now.items()
        ),
        duration_ms=duration_ms,
        file_name=found.file_name,
    )


def _record_ask(db: Session, enricher: str, video: str, now: datetime) -> None:
    db.merge(VideoAskRow(enricher=enricher, video=video, asked_at=now))


def _text_is_owned(db: Session, track_id: TrackId) -> bool:
    """Return whether the Track's video text came from a file or the household."""
    row = db.get(VideoTextRow, track_id)
    return row is not None and row.came_from in {"file", "household"}


def _keep_cover(found: EnrichedTrack, folder: Path) -> str | None:
    if found.cover is None:
        return None
    try:
        return keep_copy(found.cover, folder)
    except (OSError, NotACoverError):
        return None


def _read_text(answered: AnsweredText) -> VideoText | None:
    """Return the video's text as the core reads it, or `None` when it has no words."""
    chapters = tuple(
        Chapter(chapter.start_ms, chapter.title)
        for chapter in answered.chapters
        if chapter.start_ms <= MAX_START_MS
    )
    if not (answered.title.strip() or answered.description.strip() or chapters):
        return None
    return VideoText(answered.title, answered.description, chapters)


def _enricher_of(request: object) -> str | None:
    name = request.get("enricher") if isinstance(request, dict) else None
    return name if isinstance(name, str) else None


def _stopped_message(name: str, reason: str) -> str:
    return (
        f"{name} is stopped after the site refused a request: {reason.rstrip('.')}. "
        "An admin can reset it in Settings."
    )


def _fail_queued(db: Session, name: str, message: str, now: datetime) -> list[JobId]:
    """Fail the Jobs of the enricher that haven't started, and return them."""
    asked = JobRow.__table__.c.request["enricher"].as_string() == name
    waiting = db.scalars(
        select(JobRow).where(
            JobRow.kind == ENRICH_KIND,
            JobRow.state.in_((JobState.WAITING, JobState.QUEUED)),
            asked,
        )
    ).all()
    for row in waiting:
        row.state = JobState.FAILED
        row.failure_kind, row.failure_message = "refused", message[:2048]
        row.finished_at, row.pid = now, None
    return [JobId(row.id) for row in waiting]


def _require_admin(caller: Account) -> None:
    if not caller.is_admin:
        message = "Only an admin manages what the enrichers do for every Track."
        raise ForbiddenError(message)
