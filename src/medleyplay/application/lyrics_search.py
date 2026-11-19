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

from dataclasses import dataclass
from datetime import datetime
from functools import partial
from typing import Final

from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application import Clock
from medleyplay.application.ai import is_set_up, provider_named
from medleyplay.application.jobs import JobKind, JobService, Lane
from medleyplay.application.plugins import PluginService
from medleyplay.application.settings import read_settings
from medleyplay.domain.accounts import Account
from medleyplay.domain.catalog import TrackId
from medleyplay.domain.enrichers import AI_DETAILS, LYRICS
from medleyplay.domain.errors import ConflictError, InvalidInputError, NotFoundError
from medleyplay.domain.jobs import Job, JobState, failure_shown_to
from medleyplay.persistence.schema import LyricsSearchRow, TrackRow
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
    ) -> None:
        """Create the service, submitting Jobs of `kinds` to `jobs`."""
        self._units = units
        self._plugins = plugins
        self._jobs = jobs
        self._kinds = kinds

    def find(self, caller: Account, track_id: TrackId, title: str, artist: str) -> None:
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
        with self._units() as db:
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
            )
        self._jobs.submit(self._kinds.find, find_lyrics_target(track_id), request, caller.id)

    def choose(self, caller: Account, track_id: TrackId) -> None:
        """Ask an AI model which of the songs found is the song; asking twice waits.

        Asking while one has picked among the songs found asks nothing.
        """
        if CHOOSER not in self._plugins.available_keys().get(LYRICS_CHOOSER.name, []):
            message = "Turn on the ai-details plugin to ask an AI model."
            raise ConflictError(message)
        with self._units() as db:
            if not is_set_up(db):
                message = "Set up an AI provider in Settings to ask it."
                raise ConflictError(message)
            track = db.get(TrackRow, track_id)
            if track is None:
                message = "There is no such Track."
                raise NotFoundError(message)
            row = db.get(LyricsSearchRow, track_id)
            options = () if row is None else _options_of(row)
            if row is None or not options:
                message = "Find the song's lyrics before asking which is the song."
                raise ConflictError(message)
            if row.chosen_at is not None and _picked_among(row, options):
                return
            request = ChooseLyricsJob(
                track_id=track_id,
                title=(track.title or row.title)[:MAX_NAME],
                artist=(track.artist or row.artist)[:MAX_NAME],
                album=track.album[:MAX_NAME],
                duration_ms=track.duration_ms,
                options=tuple(_choice_of(each) for each in options),
                offered=tuple(_key_of(each) for each in options),
                chooser=CHOOSER,
            )
        self._jobs.submit(self._kinds.choose, choose_lyrics_target(track_id), request, caller.id)

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
            finding=finding is not None and finding.state.is_active,
            choosing=choosing is not None and choosing.state.is_active,
            # Asking needs the network, so it waits while medleyplay is Offline.
            waiting=any(job.state is JobState.WAITING or not self._jobs.online() for job in asking),
            failure=_failure(finding, viewer),
            choice_failure=_failure(choosing, viewer),
            may_choose=ai
            and bool(options)
            and not chosen
            and not choice_failed
            and CHOOSER in self._plugins.available_keys().get(LYRICS_CHOOSER.name, []),
        )


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
    if db.get(TrackRow, result.track_id) is None:
        return
    row = db.get(LyricsSearchRow, result.track_id) or LyricsSearchRow(track_id=result.track_id)
    row.title, row.artist, row.found_at = result.title, result.artist, clock()
    row.options = [each.model_dump(mode="json") for each in result.options]
    row.offered, row.pick, row.why, row.model, row.host, row.chosen_at = [], None, "", "", "", None
    db.add(row)


def _complete_choice(db: Session, job: Job, result: ChosenLyricsResult, *, clock: Clock) -> None:
    """Keep the song the model picked, with the model that answered.

    A pick among songs other than those found now, as songs found again since, is dropped.
    """
    del job
    row = db.get(LyricsSearchRow, result.track_id)
    if row is None or list(result.offered) != [_key_of(each) for each in _options_of(row)]:
        return
    named = provider_named(db, result.ai_answered or None)
    model, host = named if named is not None else ("an AI model", "")
    row.offered, row.pick, row.why = list(result.offered), result.option, result.why
    row.model, row.host, row.chosen_at = model, host, clock()
