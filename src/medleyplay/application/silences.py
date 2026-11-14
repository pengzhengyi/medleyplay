"""Where a Track's audio falls quiet: found once by the silence finder, and kept.

The songs editor snaps song starts to the gaps between songs. Finding them reads
the whole file, about three seconds for an hour of audio, in a Job of the kind
`find_silences` that needs no network, through the plugin `ffmpeg`. What it finds
is kept with the Track's length then, so a file whose length changed is read again.
A file that must be copied or downloaded first is prepared as playing it would be.
"""

from functools import partial
from typing import Final

from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application import Clock
from medleyplay.application.jobs import JobKind, JobService
from medleyplay.application.playback import PlaybackService, Preparing, Ready
from medleyplay.application.plugins import PluginService
from medleyplay.domain.accounts import Account
from medleyplay.domain.catalog import TrackId
from medleyplay.domain.errors import ConflictError, InvalidInputError, NotFoundError
from medleyplay.domain.jobs import Job
from medleyplay.domain.silences import Silence, Silences, SilenceState
from medleyplay.persistence.schema import SilenceRow, TrackRow
from medleyplay.plugin_api import SILENCE_FINDER, SilenceStatus
from medleyplay.programs.find_silences import FindSilencesJob, FoundSilencesResult

FIND_SILENCES_KIND: Final = "find_silences"
FINDER: Final = "ffmpeg"
"""The silence finder asked: the plugin that runs ffmpeg."""

type FindSilencesKind = JobKind[FindSilencesJob, FoundSilencesResult]

_STATES: Final = {
    SilenceStatus.OK: SilenceState.FOUND,
    SilenceStatus.NO_TOOL: SilenceState.NO_TOOL,
    SilenceStatus.UNREADABLE: SilenceState.UNREADABLE,
}


def find_silences_kind(clock: Clock) -> FindSilencesKind:
    """Return the kind of Job that finds where a Track's audio falls quiet."""
    return JobKind(
        name=FIND_SILENCES_KIND,
        program="medleyplay.programs.find_silences:FIND_SILENCES_PROGRAM",
        request=FindSilencesJob,
        result=FoundSilencesResult,
        complete=partial(_complete, clock=clock),
        points=(SILENCE_FINDER.name,),
    )


def find_silences_target(track_id: TrackId) -> str:
    """Return the target of the Job that finds the Track's silences."""
    return f"silences:{track_id}"


class SilenceService:
    """Say what is known of a Track's silences, and find them."""

    def __init__(
        self,
        units: sessionmaker[Session],
        clock: Clock,
        plugins: PluginService,
        jobs: JobService,
        kind: FindSilencesKind,
        playback: PlaybackService,
    ) -> None:
        """Create a service over the database `units` open."""
        self._units = units
        self._clock = clock
        self._plugins = plugins
        self._jobs = jobs
        self._kind = kind
        self._playback = playback

    def silences(self, track_id: TrackId) -> Silences:
        """Return what is known of the Track's silences."""
        if self._jobs.active(FIND_SILENCES_KIND, find_silences_target(track_id)) is not None:
            return Silences(SilenceState.FINDING)
        with self._units() as db:
            track = db.get(TrackRow, track_id)
            if track is None:
                message = f"No Track has the id {track_id}."
                raise NotFoundError(message)
            row = db.get(SilenceRow, track_id)
            if row is None or row.length_ms != track.duration_ms:
                return Silences(SilenceState.NOT_FOUND)
            state = _STATES[SilenceStatus(row.status)]
            found = tuple(Silence(each["start_ms"], each["end_ms"]) for each in row.silences)
        return Silences(state, found)

    def find(self, caller: Account, track_id: TrackId) -> Silences:
        """Find the Track's silences, unless they are known or being found; say where that is.

        A file that must be copied or downloaded first is prepared, and found once it is.
        """
        if FINDER not in self._plugins.available_keys().get(SILENCE_FINDER.name, []):
            message = "Turn on the ffmpeg plugin to find the gaps in the audio."
            raise ConflictError(message)
        known = self.silences(track_id)
        if known.state in {SilenceState.FOUND, SilenceState.FINDING}:
            return known
        match self._playback.play(caller, track_id):
            case Ready(stretch=stretch) if stretch is not None:
                message = "Find the gaps in the whole file, not in one of its songs."
                raise InvalidInputError(message)
            case Ready(source_id=source_id):
                audio = self._playback.local_audio(source_id)
                if audio is None:
                    return Silences(SilenceState.PREPARING)
                request = FindSilencesJob(
                    track_id=track_id,
                    local_path=audio.path,
                    offset=audio.offset,
                    length=audio.length,
                    finder=FINDER,
                )
                self._jobs.submit(self._kind, find_silences_target(track_id), request, caller.id)
                return Silences(SilenceState.FINDING)
            case Preparing():
                return Silences(SilenceState.PREPARING)
            case _:
                message = "This file can't be played, so the gaps in it can't be found."
                raise ConflictError(message)


def _complete(db: Session, job: Job, result: FoundSilencesResult, *, clock: Clock) -> None:
    """Keep the silences found, with the Track's length now, in place of any found before."""
    del job
    track = db.get(TrackRow, result.track_id)
    if track is None:
        return
    row = db.get(SilenceRow, result.track_id) or SilenceRow(track_id=result.track_id)
    row.status = result.status.value
    row.silences = [{"start_ms": each.start_ms, "end_ms": each.end_ms} for each in result.silences]
    row.length_ms = track.duration_ms
    row.found_at = clock()
    db.add(row)
