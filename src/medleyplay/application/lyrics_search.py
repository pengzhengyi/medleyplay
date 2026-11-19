"""Looking for a song's lyrics by hand: the songs the lyrics sites find of a title and artist.

The household asks by a title and artist of its own, which may not be the Library's,
as a video's title rarely is. Finding is a Job in the lyrics enricher's lane: LRCLIB
is searched, then the sites the household turned on, and the songs found are kept for
the song with their lyrics, the closest in length first. Finding again replaces them.
Nothing changes the song's lyrics until the household chooses some and saves them.
"""

from dataclasses import dataclass
from datetime import datetime
from functools import partial
from typing import Final

from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application import Clock
from medleyplay.application.jobs import JobKind, JobService, Lane
from medleyplay.application.plugins import PluginService
from medleyplay.application.settings import read_settings
from medleyplay.domain.accounts import Account
from medleyplay.domain.catalog import TrackId
from medleyplay.domain.enrichers import LYRICS
from medleyplay.domain.errors import ConflictError, InvalidInputError, NotFoundError
from medleyplay.domain.jobs import Job, JobState, failure_shown_to
from medleyplay.persistence.schema import LyricsSearchRow, TrackRow
from medleyplay.plugin_api import LYRICS_FINDER, MAX_NAME, LyricsOption, LyricsProvider
from medleyplay.programs.find_lyrics import FindLyricsJob, FoundLyricsResult

FIND_LYRICS_KIND: Final = "find_lyrics"
FINDER: Final = LYRICS.name
"""The finder asked: the lyrics plugin, in the lane its enricher keeps to."""

type FindLyricsKind = JobKind[FindLyricsJob, FoundLyricsResult]


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


@dataclass(frozen=True)
class LyricsFound:
    """What was found when the household last looked for a song's lyrics, and what is asked.

    `options` are the songs found of `title` by `artist`, at `found_at`, the closest
    first. `finding` says whether the sites are asked now, and `waiting` that the
    asking waits for medleyplay to be Online, or to try again. `failure` says why the
    last asking failed, to the Account that asked and to admins.
    """

    title: str
    artist: str
    options: tuple[LyricsOption, ...]
    found_at: datetime | None
    finding: bool
    waiting: bool
    failure: str | None


class LyricsSearchService:
    """Finds the songs the lyrics sites have of a title and artist, for a song."""

    def __init__(
        self,
        units: sessionmaker[Session],
        plugins: PluginService,
        jobs: JobService,
        kind: FindLyricsKind,
    ) -> None:
        """Create the service, submitting Jobs of `kind` to `jobs`."""
        self._units = units
        self._plugins = plugins
        self._jobs = jobs
        self._kind = kind

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
        self._jobs.submit(self._kind, find_lyrics_target(track_id), request, caller.id)

    def found(self, viewer: Account, track_id: TrackId) -> LyricsFound:
        """Return what was found when the song's lyrics were last looked for, and what is asked."""
        with self._units() as db:
            row = db.get(LyricsSearchRow, track_id)
            options = () if row is None else _options_of(row)
            title, artist = ("", "") if row is None else (row.title, row.artist)
            found_at = None if row is None else row.found_at
        finding = self._jobs.latest(FIND_LYRICS_KIND, find_lyrics_target(track_id))
        active = finding is not None and finding.state.is_active
        return LyricsFound(
            title=title,
            artist=artist,
            options=options,
            found_at=found_at,
            finding=active,
            # Asking needs the network, so it waits while medleyplay is Offline.
            waiting=active
            and finding is not None
            and (finding.state is JobState.WAITING or not self._jobs.online()),
            failure=_failure(finding, viewer),
        )


def _failure(job: Job | None, viewer: Account) -> str | None:
    if job is None or job.state is not JobState.FAILED:
        return None
    return failure_shown_to(job, viewer) or None


def _options_of(row: LyricsSearchRow) -> tuple[LyricsOption, ...]:
    return tuple(LyricsOption.model_validate(each) for each in row.options)


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
    db.add(row)
