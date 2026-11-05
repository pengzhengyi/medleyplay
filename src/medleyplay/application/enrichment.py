"""Enrichment: asking a site for the details a Track's file does not say, when someone asks.

Nothing here runs by itself. A Track is asked for when a person chooses *Find details
online* (Bilibili), *Find on MusicBrainz*, or *Suggest details with AI* for it, or an
admin chooses it for every Track that is eligible; each Track is one Job, and the Jobs
of an enricher run one at a time with a pause between them. What the site says is
recorded as the enricher's origin, and the first time the site refuses a request the
enricher stops until an admin resets it:

```text
Find details online     one Track          any Account
Find details for all    every eligible     an admin
Reset                   a stopped enricher an admin
```
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from functools import partial
from pathlib import Path
from typing import Final

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application import Clock, details
from medleyplay.application.ai import is_set_up
from medleyplay.application.enrich_candidates import Candidate, candidates
from medleyplay.application.jobs import JobKind, JobService, Lane
from medleyplay.application.plugins import PluginService
from medleyplay.application.scan_covers import NotACoverError, keep_copy
from medleyplay.domain.accounts import Account
from medleyplay.domain.ai import cut_text
from medleyplay.domain.catalog import TrackId
from medleyplay.domain.details import Field, Origin, Shown, check_values, shown
from medleyplay.domain.enrichers import (
    ENRICHERS,
    MESSAGES,
    Enricher,
    Ineligible,
    Subject,
    enricher_named,
    why_not,
)
from medleyplay.domain.errors import (
    ConflictError,
    ForbiddenError,
    NotFoundError,
    PluginUnavailableError,
)
from medleyplay.domain.jobs import Job, JobId, JobState
from medleyplay.domain.video_text import Chapter, Song, VideoText
from medleyplay.persistence.schema import (
    EnricherAskRow,
    EnricherStopRow,
    JobRow,
    TrackRow,
    VideoTextRow,
)
from medleyplay.plugin_api import TRACK_ENRICHER, ShownDetail
from medleyplay.plugin_api import Chapter as AskedChapter
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
            each.name: Lane(spacing=each.spacing, proxy_site=each.site, lends_ai=each.uses_ai)
            for each in ENRICHERS.values()
        },
        refuse_start=_refuse_start,
        on_failure=partial(_on_failure, clock=clock),
    )


def _complete(
    db: Session, job: Job, found: EnrichedTrack, *, clock: Clock, covers_folder: Path
) -> None:
    """Note that the subject was asked, and record what the site said unless the Track moved on.

    A Track whose video text came from a file or the household since the Job was queued
    is left as it is by an enricher that reads videos.
    """
    enricher, now = enricher_named(found.enricher), clock()
    _record_ask(db, enricher.name, found.subject, now)
    track_id = TrackId(int(job.target.removeprefix("track:")))
    if db.get(TrackRow, track_id) is None:
        return
    if enricher.subject is Subject.VIDEO and _text_is_owned(db, track_id):
        return
    if enricher.origin is Origin.AI:
        _record_suggestion(db, track_id, found, now)
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


def _record_suggestion(db: Session, track_id: TrackId, found: EnrichedTrack, now: datetime) -> None:
    """Record what the AI suggested, in place of its last suggestion; it shows nowhere.

    An answer that suggests nothing clears the last suggestion.
    """
    details.record(db, track_id, Origin.AI, dict(check_values(found.values)), now)
    songs = [Song(song.start_ms, song.title, song.artist) for song in found.songs]
    details.record_suggested_songs(db, track_id, songs, now)


def _refuse_start(db: Session, request: object) -> str | None:
    name = _enricher_of(request)
    if name is None:
        return None
    stop = db.get(EnricherStopRow, name)
    if stop is not None:
        return _stopped_message(stop.enricher, stop.reason)
    return (
        None
        if is_set_up(db) or not enricher_named(name).uses_ai
        else MESSAGES[Ineligible.NOT_SET_UP]
    )


def _on_failure(db: Session, job: Job, kind: str, message: str, *, clock: Clock) -> Sequence[JobId]:
    """Note that a subject the site couldn't answer for was asked, and stop on a refusal.

    A video the site no longer has, and an answer the enricher couldn't use, count as
    asking, since the site was asked. A refusal stops the enricher and fails its Jobs
    that haven't started; it doesn't count as asking, so the subject that was refused is
    eligible once an admin resets the enricher. Return the Jobs failed.
    """
    request = db.get_one(JobRow, job.id).request
    name, subject = _enricher_of(request), request.get("subject")
    if name is None:
        return []
    now = clock()
    if kind in {"gone", "invalid"} and isinstance(subject, str):
        _record_ask(db, name, subject, now)
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
            set_up = is_set_up(db)
            eligible = candidates(db, enricher, None)
        return [
            track_id
            for track_id, found in eligible.items()
            if why_not(found.facts, now, stopped=False, enricher=enricher, set_up=set_up) is None
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
            found = candidates(db, enricher, [track_id]).get(track_id)
            if found is None:
                message = f"No Track has the id {track_id}."
                raise NotFoundError(message)
            own = {
                o: v for o, v in details.values_of(db, track_id).items() if o is not enricher.origin
            }
            shown_now = shown(own)
            duration_ms = db.scalar(select(TrackRow.duration_ms).where(TrackRow.id == track_id))
            set_up = is_set_up(db)
            text = details.video_text_of(db, track_id) if enricher.uses_ai else None
        reason = why_not(found.facts, now, stopped=stopped, enricher=enricher, set_up=set_up)
        if reason is not None:
            raise ConflictError(MESSAGES[reason])
        return self._jobs.submit(
            self._kind,
            enrich_target(track_id),
            _request(enricher, found, shown_now, duration_ms, text),
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


def _request(
    enricher: Enricher,
    found: Candidate,
    shown_now: Mapping[Field, Shown],
    duration_ms: int | None,
    text: VideoText | None,
) -> EnrichJob:
    subject = found.facts.subject
    if subject is None:  # pragma: no cover -- an eligible Track has something to ask about
        raise ValueError(subject)
    return EnrichJob(
        enricher=enricher.name,
        subject=subject,
        video=found.video,
        shown=tuple(
            ShownDetail(field=str(field), value=each.value, origin=str(each.origin))
            for field, each in shown_now.items()
        ),
        duration_ms=duration_ms,
        file_name=found.file_name,
        whole_album=found.whole_album,
        text=None if text is None else _asked_text(text),
    )


def _record_ask(db: Session, enricher: str, subject: str, now: datetime) -> None:
    db.merge(EnricherAskRow(enricher=enricher, subject=subject, asked_at=now))


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


def _asked_text(text: VideoText) -> AnsweredText:
    """Return the video's text cut to what the AI is sent, as the plugin API carries it."""
    cut = cut_text(text)
    chapters = tuple(
        AskedChapter(start_ms=each.start_ms, title=each.title) for each in cut.chapters
    )
    return AnsweredText(title=cut.title, description=cut.description, chapters=chapters)


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
    source = ENRICHERS[name].source if name in ENRICHERS else "the site"
    return (
        f"{name} is stopped after {source} refused a request: {reason.rstrip('.')}. "
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
