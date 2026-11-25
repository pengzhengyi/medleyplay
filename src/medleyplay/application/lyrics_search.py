"""Looking for a song's lyrics by hand: the songs the lyrics sites find of a title and artist.

The household asks by a title and artist of its own, which may not be the Library's,
as a video's title rarely is. Finding is a Job in the lyrics enricher's lane: LRCLIB
is searched, then the sites the household turned on, and the songs found are kept for
the song with their lyrics, the closest in length first. Finding again replaces them.
Then, asked for it, an AI model is shown the song and what tells each song found apart,
never their words, and picks the one that is the song, in the AI's lane; its pick
stands while those are the songs found. Nothing changes the song's lyrics until the
household chooses some and saves them.
"""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from functools import partial
from typing import Final

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application import Clock
from medleyplay.application.ai import is_set_up, provider_named
from medleyplay.application.jobs import JobKind, JobService, Lane
from medleyplay.application.lyrics import record_lyrics
from medleyplay.application.lyrics_match_state import (
    MATCH_CHOOSE,
    MATCH_FIND,
    active_match,
    discard_pending_pick,
    match_target,
    require_no_active_match,
    supersede_match,
)
from medleyplay.application.plugins import PluginService
from medleyplay.application.settings import read_settings
from medleyplay.domain.accounts import Account
from medleyplay.domain.catalog import TrackId
from medleyplay.domain.enrichers import AI_DETAILS, LYRICS
from medleyplay.domain.errors import ConflictError, InvalidInputError, NotFoundError
from medleyplay.domain.jobs import Job, JobId, JobState, failure_shown_to
from medleyplay.domain.lyrics import LyricsOrigin, parse_lyrics
from medleyplay.persistence.schema import (
    JobRow,
    LyricsSearchRow,
    SegmentRow,
    TrackLyricsRow,
    TrackRow,
)
from medleyplay.plugin_api import (
    LYRICS_CHOOSER,
    LYRICS_FINDER,
    MAX_NAME,
    LyricsChoice,
    LyricsOption,
    LyricsProvider,
)
from medleyplay.programs.find_lyrics import (
    ChooseLyricsJob,
    ChosenLyricsResult,
    FindLyricsJob,
    FoundLyricsResult,
    MatchSong,
)

FIND_LYRICS_KIND: Final = "find_lyrics"
FINDER: Final = LYRICS.name
"""The finder asked: the lyrics plugin, in the lane its enricher keeps to."""
CHOOSE_LYRICS_KIND: Final = "choose_lyrics"
CHOOSER: Final = AI_DETAILS.name
"""The chooser asked: the AI plugin, in the lane its enricher keeps to."""
CHOICE_TARGET: Final = "lyrics-choice:"
"""What the target of a Job that asks which song found is the song begins with, before its id."""

type FindLyricsKind = JobKind[FindLyricsJob, FoundLyricsResult]
type ChooseLyricsKind = JobKind[ChooseLyricsJob, ChosenLyricsResult]


def find_lyrics_target(track_id: TrackId) -> str:
    """Return the target of the Job that finds the lyrics of the Track `track_id`."""
    return f"lyrics-search:{track_id}"


def find_lyrics_kind(clock: Clock) -> FindLyricsKind:
    """Return the kind of Job that finds a song's lyrics, sharing the lyrics enricher's pace."""
    return JobKind(
        name=FIND_LYRICS_KIND,
        program="medleyplay.programs.find_lyrics:FIND_LYRICS_PROGRAM",
        request=FindLyricsJob,
        result=FoundLyricsResult,
        complete=partial(_complete_find, clock=clock),
        points=(LYRICS_FINDER.name,),
        needs_network=True,
        lane_field="finder",
        lanes={FINDER: Lane(spacing=LYRICS.spacing, shared=LYRICS.name)},
        on_submit=_before_manual_lyrics_job,
    )


def choose_lyrics_target(track_id: TrackId) -> str:
    """Return the target of the Job that asks an AI model which song found is the song."""
    return f"{CHOICE_TARGET}{track_id}"


def choose_lyrics_kind(clock: Clock) -> ChooseLyricsKind:
    """Return the kind of Job that asks an AI model which of the songs found is the song."""
    return JobKind(
        name=CHOOSE_LYRICS_KIND,
        program="medleyplay.programs.find_lyrics:CHOOSE_LYRICS_PROGRAM",
        request=ChooseLyricsJob,
        result=ChosenLyricsResult,
        complete=partial(_complete_choice, clock=clock),
        points=(LYRICS_CHOOSER.name,),
        needs_network=True,
        lane_field="chooser",
        lanes={CHOOSER: Lane(spacing=AI_DETAILS.spacing, lends_ai=True, shared=AI_DETAILS.name)},
        on_submit=_before_manual_lyrics_job,
    )


@dataclass(frozen=True)
class LyricsSearchKinds:
    """The kinds of Job the service submits: finding lyrics, and choosing among them."""

    find: FindLyricsKind
    choose: ChooseLyricsKind


def lyrics_search_kinds(clock: Clock) -> LyricsSearchKinds:
    """Return the kinds of Job the lyrics search service submits."""
    return LyricsSearchKinds(find_lyrics_kind(clock), choose_lyrics_kind(clock))


@dataclass(frozen=True)
class LyricsPick:
    """The song an AI model picked of those found, by its place, why, and who answered."""

    option: int
    why: str
    model: str
    host: str
    at: datetime


@dataclass(frozen=True)
class LyricsFound:
    """What was found when the household last looked for a song's lyrics, and what is asked.

    `options` are the songs found of `title` by `artist`, at `found_at`, the closest
    first, and `pick` an AI model's pick among them, while they are the songs it was
    shown. `finding` and `choosing` say whether the sites or a model are asked now, and
    `waiting` that the asking waits for medleyplay to be Online, or to try again.
    `failure` and `choice_failure` say why the last asking failed, to the Account that
    asked and to admins. `may_choose` says a model may be asked: one is set up, songs
    were found, and none picked among them.
    """

    title: str
    artist: str
    options: tuple[LyricsOption, ...]
    found_at: datetime | None
    pick: LyricsPick | None
    finding: bool
    choosing: bool
    waiting: bool
    failure: str | None
    choice_failure: str | None
    may_choose: bool


class LyricsSearchService:
    """Finds the songs the lyrics sites have of a title and artist, for a song."""

    def __init__(
        self,
        units: sessionmaker[Session],
        plugins: PluginService,
        jobs: JobService,
        kinds: LyricsSearchKinds,
        on_change: Callable[[str], None] | None = None,
    ) -> None:
        """Create the service, submitting Jobs of `kinds` to `jobs`."""
        self._units = units
        self._plugins = plugins
        self._jobs = jobs
        self._kinds = kinds
        self._on_change = on_change

    def find(
        self,
        caller: Account,
        track_id: TrackId,
        title: str,
        artist: str,
        *,
        match: MatchSong | None = None,
    ) -> JobId:
        """Ask the sites for the songs titled `title` by `artist`; asking again while asked waits.

        `artist` may be empty. The Track's length tells its songs apart from others.
        """
        title, artist = title.strip(), artist.strip()
        if not title:
            message = "Give a title to find the song's lyrics."
            raise InvalidInputError(message)
        if len(title) > MAX_NAME or len(artist) > MAX_NAME:
            message = f"A title and an artist are each at most {MAX_NAME} characters."
            raise InvalidInputError(message)
        if FINDER not in self._plugins.available_keys().get(LYRICS_FINDER.name, []):
            message = "Turn on the lyrics plugin to find lyrics."
            raise ConflictError(message)
        target = find_lyrics_target(track_id)
        with self._units.begin() as db:
            db.connection().exec_driver_sql("BEGIN IMMEDIATE")
            track = db.get(TrackRow, track_id)
            if track is None:
                message = "There is no such Track."
                raise NotFoundError(message)
            sites = tuple(LyricsProvider(site.value) for site in read_settings(db).lyrics_sites)
            request = FindLyricsJob(
                track_id=track_id,
                title=title,
                artist=artist,
                duration_ms=track.duration_ms,
                sites=sites,
                finder=FINDER,
                match=match,
            )
            if match is not None:
                require_no_active_match(db, track_id)
                previous = _current_staged_search(db, track_id)
                if (
                    previous is not None
                    and FindLyricsJob.model_validate(previous.request) == request
                ):
                    return JobId(previous.id)
            cancelled = supersede_match(db, self._jobs, track_id)
            job, queued = self._jobs.submit_in(db, self._kinds.find, target, request, caller.id)
        if cancelled is not None:
            self._jobs.announce_cancelled(cancelled)
        if queued:
            self._jobs.announce_queued(job.id)
        return job.id

    def start_match(self, caller: Account, track_id: TrackId, match: MatchSong) -> JobId:
        """Search by the saved child Track, only while the row still names that song."""
        with self._units() as db:
            require_matching(db, self._jobs, self._plugins)
            track = db.get(TrackRow, track_id)
            if track is None or not _segment_matches(db, track_id, match):
                raise ConflictError(_CHANGED)
            require_empty(db, track_id)
            title, artist = track.title, track.artist
        return self.find(caller, track_id, title, artist, match=match)

    def apply_match(self, track_id: TrackId, search_job: JobId, chosen_at: datetime) -> None:
        """Keep a site's pick only while this search, choice and empty saved song still agree."""
        with self._units.begin() as db:
            require_matching(db, self._jobs, self._plugins)
            # Take SQLite's writer lock before checking for another household member's edit.
            db.connection().exec_driver_sql("BEGIN IMMEDIATE")
            require_empty(db, track_id)
            find = _current_staged_search(db, track_id)
            choice = _latest_job(db, CHOOSE_LYRICS_KIND, choose_lyrics_target(track_id))
            if find is None or find.id != search_job or choice is None:
                raise ConflictError(_CHANGED)
            search = FindLyricsJob.model_validate(find.request)
            asked = ChooseLyricsJob.model_validate(choice.request)
            row = db.get(LyricsSearchRow, track_id)
            if asked.search_job != search_job or row is None or row.chosen_at != chosen_at:
                raise ConflictError(_CHANGED)
            save_match_in(db, search, asked, row, chosen_at)
        if self._on_change is not None:
            self._on_change("lyrics")

    def choose(self, caller: Account, track_id: TrackId, *, match_job: JobId | None = None) -> None:
        """Ask an AI model which of the songs found is the song; asking twice waits.

        Asking while one has picked among the songs found asks nothing.
        """
        if CHOOSER not in self._plugins.available_keys().get(LYRICS_CHOOSER.name, []):
            message = "Turn on the ai-details plugin to ask an AI model."
            raise ConflictError(message)
        with self._units.begin() as db:
            db.connection().exec_driver_sql("BEGIN IMMEDIATE")
            require_no_active_match(db, track_id)
            if not is_set_up(db):
                message = "Set up an AI provider in Settings to ask it."
                raise ConflictError(message)
            track = db.get(TrackRow, track_id)
            if track is None:
                message = "There is no such Track."
                raise NotFoundError(message)
            row = db.get(LyricsSearchRow, track_id)
            search = _current_staged_search(db, track_id)
            if match_job is not None:
                require_matching(db, self._jobs, self._plugins)
                require_empty(db, track_id)
                if search is None or search.id != match_job:
                    raise ConflictError(_CHANGED)
                expected = FindLyricsJob.model_validate(search.request)
                require_same_search(db, track, expected)
            options = () if row is None else _options_of(row)
            if row is None or not options:
                message = "Find the song's lyrics before asking which is the song."
                raise ConflictError(message)
            if row.chosen_at is not None and _picked_among(row, options):
                return
            request = choice_request(track, row, options, search.id if search is not None else None)
            job, queued = self._jobs.submit_in(
                db, self._kinds.choose, choose_lyrics_target(track_id), request, caller.id
            )
        if queued:
            self._jobs.announce_queued(job.id)

    def found(self, viewer: Account, track_id: TrackId) -> LyricsFound:
        """Return what was found when the song's lyrics were last looked for, and what is asked."""
        with self._units() as db:
            row = db.get(LyricsSearchRow, track_id)
            options = () if row is None else _options_of(row)
            title, artist = ("", "") if row is None else (row.title, row.artist)
            found_at = None if row is None else row.found_at
            pick = None if row is None else _pick_of(row, options)
            chosen = row is not None and row.chosen_at is not None and _picked_among(row, options)
            ai = is_set_up(db)
            matching = active_match(db, track_id)
        finding = self._jobs.latest(FIND_LYRICS_KIND, find_lyrics_target(track_id))
        choosing = self._jobs.latest(CHOOSE_LYRICS_KIND, choose_lyrics_target(track_id))
        asking = [job for job in (finding, choosing) if job is not None and job.state.is_active]
        choice_failed = choosing is not None and choosing.state is JobState.FAILED
        return LyricsFound(
            title=title,
            artist=artist,
            options=options,
            found_at=found_at,
            pick=pick,
            finding=(matching is not None and matching.kind == MATCH_FIND)
            or (finding is not None and finding.state.is_active),
            choosing=(matching is not None and matching.kind == MATCH_CHOOSE)
            or (choosing is not None and choosing.state.is_active),
            # Asking needs the network, so it waits while medleyplay is Offline.
            waiting=any(job.state is JobState.WAITING or not self._jobs.online() for job in asking)
            or (
                matching is not None
                and (matching.state == JobState.WAITING or not self._jobs.online())
            ),
            failure=_failure(finding, viewer),
            choice_failure=_failure(choosing, viewer),
            may_choose=ai
            and matching is None
            and bool(options)
            and not chosen
            and not choice_failed
            and CHOOSER in self._plugins.available_keys().get(LYRICS_CHOOSER.name, []),
        )


_CHANGED = "The song or its lyrics search changed. Nothing was saved."


def _before_manual_lyrics_job(db: Session, job: Job) -> None:
    track_id = TrackId(int(job.target.rsplit(":", maxsplit=1)[-1]))
    require_no_active_match(db, track_id)
    discard_pending_pick(db, track_id)


def require_matching(db: Session, jobs: JobService, plugins: PluginService) -> None:
    """Refuse an explicit Auto-Match start when the finder or chooser is unavailable."""
    if not jobs.online():
        message = "Go Online to auto-match lyrics."
        raise ConflictError(message)
    require_match_providers(db, plugins)


def require_match_providers(db: Session, plugins: PluginService) -> None:
    """Require the configured finder and chooser regardless of whether the server is Online."""
    available = plugins.available_keys()
    if FINDER not in available.get(LYRICS_FINDER.name, []):
        message = "Turn on the lyrics plugin to auto-match lyrics."
        raise ConflictError(message)
    if CHOOSER not in available.get(LYRICS_CHOOSER.name, []) or not is_set_up(db):
        message = "Set up an AI provider and turn on ai-details to auto-match lyrics."
        raise ConflictError(message)


def choice_request(
    track: TrackRow, row: LyricsSearchRow, options: tuple[LyricsOption, ...], search_job: int | None
) -> ChooseLyricsJob:
    """Capture the exact candidates and song details shown to the chooser."""
    return ChooseLyricsJob(
        track_id=track.id,
        title=(track.title or row.title)[:MAX_NAME],
        artist=(track.artist or row.artist)[:MAX_NAME],
        album=track.album[:MAX_NAME],
        duration_ms=track.duration_ms,
        options=tuple(_choice_of(each) for each in options),
        offered=tuple(_key_of(each) for each in options),
        chooser=CHOOSER,
        search_job=search_job,
    )


def save_match_in(
    db: Session, search: FindLyricsJob, asked: ChooseLyricsJob, row: LyricsSearchRow, at: datetime
) -> None:
    """Save a validated pick in the caller's write transaction without replacing lyrics."""
    option = validate_match_in(db, search, asked, row)
    record_lyrics(
        db,
        TrackId(search.track_id),
        LyricsOrigin(option.provider.value),
        option.text,
        at,
        instrumental=option.instrumental,
    )


def validate_match_in(
    db: Session, search: FindLyricsJob, asked: ChooseLyricsJob, row: LyricsSearchRow
) -> LyricsOption:
    """Return the unique, enabled site's pick for a still empty, unchanged song."""
    track_id = TrackId(search.track_id)
    require_empty(db, track_id)
    _require_same_song(db, track_id, search, asked)
    option = _matched_option(row, search, asked)
    enabled = {
        LyricsProvider.LRCLIB.value,
        *(site.value for site in read_settings(db).lyrics_sites),
    }
    if option.provider.value not in enabled:
        raise ConflictError(_CHANGED)
    parse_lyrics(option.text)
    return option


def _latest_job(db: Session, kind: str, target: str) -> JobRow | None:
    row = db.scalar(
        select(JobRow)
        .where(JobRow.kind == kind, JobRow.target == target)
        .order_by(JobRow.id.desc())
        .limit(1)
    )
    return row if row is not None and row.state == JobState.SUCCEEDED else None


def _current_staged_search(db: Session, track_id: TrackId) -> JobRow | None:
    search = _latest_job(db, FIND_LYRICS_KIND, find_lyrics_target(track_id))
    if search is None:
        return None
    has_newer_match = db.scalar(
        select(JobRow.id)
        .where(
            JobRow.kind == MATCH_FIND,
            JobRow.target == match_target(track_id),
            JobRow.id > search.id,
        )
        .limit(1)
    )
    return search if has_newer_match is None else None


def require_empty(db: Session, track_id: TrackId) -> None:
    """Refuse Auto-Match when any lyrics are kept, even if not shown."""
    if (
        db.scalar(
            select(TrackLyricsRow.track_id).where(TrackLyricsRow.track_id == track_id).limit(1)
        )
        is not None
    ):
        message = "Skipped: this song already has lyrics or a dismissed suggestion."
        raise ConflictError(message)


def _segment_matches(db: Session, track_id: TrackId, match: MatchSong) -> bool:
    segment = db.get(SegmentRow, match.segment_id)
    return segment is not None and (
        segment.track_id,
        segment.start_ms,
        segment.title,
        segment.artist,
    ) == (track_id, match.start_ms, match.title, match.artist)


def require_same_search(db: Session, track: TrackRow, search: FindLyricsJob) -> None:
    """Refuse an Auto-Match whose saved segment or Track details have changed."""
    if search.match is None or not _segment_matches(db, TrackId(track.id), search.match):
        raise ConflictError(_CHANGED)
    song = (track.title.strip(), track.artist.strip(), track.duration_ms)
    if song != (search.title, search.artist, search.duration_ms):
        raise ConflictError(_CHANGED)
    if search.match_album is not None and track.album != search.match_album:
        raise ConflictError(_CHANGED)


def _require_same_song(
    db: Session, track_id: TrackId, search: FindLyricsJob, asked: ChooseLyricsJob
) -> None:
    track = db.get(TrackRow, track_id)
    if track is None or (track.title, track.artist, track.album, track.duration_ms) != (
        asked.title,
        asked.artist,
        asked.album,
        asked.duration_ms,
    ):
        raise ConflictError(_CHANGED)
    require_same_search(db, track, search)


def _matched_option(
    row: LyricsSearchRow, search: FindLyricsJob, asked: ChooseLyricsJob
) -> LyricsOption:
    options = _options_of(row)
    pick = _pick_of(row, options)
    if (
        (row.title, row.artist) != (search.title, search.artist)
        or pick is None
        or not 0 <= pick.option < len(options)
    ):
        raise ConflictError(_CHANGED)
    if tuple(_choice_of(each) for each in options) != asked.options:
        raise ConflictError(_CHANGED)
    option = options[pick.option]

    def recording(each: LyricsOption) -> tuple[str, str, str, int | None]:
        return (
            each.title.casefold(),
            each.artist.casefold(),
            each.album.casefold(),
            each.duration_ms,
        )

    if sum(recording(each) == recording(option) for each in options) != 1:
        message = "Skipped: more than one candidate matches that recording."
        raise ConflictError(message)
    return option


def _failure(job: Job | None, viewer: Account) -> str | None:
    if job is None or job.state is not JobState.FAILED:
        return None
    return failure_shown_to(job, viewer) or None


def _options_of(row: LyricsSearchRow) -> tuple[LyricsOption, ...]:
    return tuple(LyricsOption.model_validate(each) for each in row.options)


def _key_of(option: LyricsOption) -> str:
    """Return what names a song found, to tell whether a pick was among the songs found now."""
    return f"{option.provider.value}\n{option.title}\n{option.artist}\n{option.duration_ms}"


def _choice_of(option: LyricsOption) -> LyricsChoice:
    """Return a song found as a model is shown it: what tells it apart, without its words."""
    return LyricsChoice(
        provider=option.provider,
        title=option.title,
        artist=option.artist,
        album=option.album,
        duration_ms=option.duration_ms,
        timed=_timed(option.text),
        instrumental=option.instrumental,
    )


def _timed(text: str) -> bool:
    """Return whether lyrics are LRC, timed line by line."""
    return any(
        line.lstrip().startswith("[") and line.lstrip()[1:2].isdigit() for line in text.splitlines()
    )


def _picked_among(row: LyricsSearchRow, options: tuple[LyricsOption, ...]) -> bool:
    """Return whether the model that last picked was shown the songs found now."""
    return list(row.offered) == [_key_of(each) for each in options]


def _pick_of(row: LyricsSearchRow, options: tuple[LyricsOption, ...]) -> LyricsPick | None:
    if row.pick is None or row.chosen_at is None or not _picked_among(row, options):
        return None
    return LyricsPick(
        option=row.pick, why=row.why, model=row.model, host=row.host, at=row.chosen_at
    )


def _complete_find(db: Session, job: Job, result: FoundLyricsResult, *, clock: Clock) -> None:
    """Keep the songs found for the Track, replacing those found before.

    A Track gone since the asking keeps nothing.
    """
    del job
    store_search(db, result, clock)


def store_search(db: Session, result: FoundLyricsResult, clock: Clock) -> LyricsSearchRow | None:
    """Keep the new candidates and clear the pick from an older search."""
    if db.get(TrackRow, result.track_id) is None:
        return None
    row = db.get(LyricsSearchRow, result.track_id) or LyricsSearchRow(track_id=result.track_id)
    row.title, row.artist, row.found_at = result.title, result.artist, clock()
    row.options = [each.model_dump(mode="json") for each in result.options]
    row.offered, row.pick, row.why, row.model, row.host, row.chosen_at = [], None, "", "", "", None
    row.match_choice_job_id, row.match_confirmed = None, False
    db.add(row)
    return row


def _complete_choice(db: Session, job: Job, result: ChosenLyricsResult, *, clock: Clock) -> None:
    """Keep the song the model picked, with the model that answered.

    A pick among songs other than those found now, as songs found again since, is dropped.
    """
    submitted = db.get(JobRow, job.id)
    expected = None if submitted is None else submitted.request.get("search_job")
    if expected is not None:
        latest = _latest_job(db, FIND_LYRICS_KIND, find_lyrics_target(TrackId(result.track_id)))
        if latest is None or latest.id != expected:
            return
    row = db.get(LyricsSearchRow, result.track_id)
    if row is not None:
        store_choice(db, row, result, clock)


def store_choice(
    db: Session, row: LyricsSearchRow, result: ChosenLyricsResult, clock: Clock
) -> datetime | None:
    """Keep a pick for these candidates and return its timestamp."""
    if list(result.offered) != [_key_of(each) for each in _options_of(row)]:
        return None
    named = provider_named(db, result.ai_answered or None)
    model, host = named if named is not None else ("an AI model", "")
    row.offered, row.pick, row.why = list(result.offered), result.option, result.why
    at = clock()
    row.model, row.host, row.chosen_at = model, host, at
    row.match_choice_job_id, row.match_confirmed = None, False
    return at
