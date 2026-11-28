"""Where a Track's audio falls quiet: found once by the silence finder, and kept.

The songs editor snaps song starts to the gaps between songs. Finding them reads
the whole file, about three seconds for an hour of audio, in a Job of the kind
`find_silences` that needs no network, through the plugin `ffmpeg`. What it finds
is kept with the Track's length then, so a file whose length changed is read again.
A file that must be copied or downloaded first is prepared as playing it would be.
"""

from functools import partial
from pathlib import Path
from typing import Final

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application import Clock
from medleyplay.application.download_files import download_basename
from medleyplay.application.jobs import JobCompletion, JobKind, JobService
from medleyplay.application.playback import PlaybackService, Preparing, Ready
from medleyplay.application.plugins import PluginService
from medleyplay.domain.accounts import Account
from medleyplay.domain.catalog import TrackId
from medleyplay.domain.downloads import DOWNLOADS_FOLDER
from medleyplay.domain.errors import ConflictError, InvalidInputError, NotFoundError
from medleyplay.domain.jobs import Job
from medleyplay.domain.links import BILIBILI_SOURCE
from medleyplay.domain.silences import FIND_SILENCES_KIND, Silence, Silences, SilenceState
from medleyplay.persistence.schema import DownloadRow, JobRow, SilenceRow, SourceRow, TrackRow
from medleyplay.plugin_api import SILENCE_FINDER, SilenceStatus
from medleyplay.programs.find_silences import FindSilencesJob, FoundSilencesResult

FINDER: Final = "ffmpeg"
"""The silence finder asked: the plugin that runs ffmpeg."""

type FindSilencesKind = JobKind[FindSilencesJob, FoundSilencesResult]

_STATES: Final = {
    SilenceStatus.OK: SilenceState.FOUND,
    SilenceStatus.NO_TOOL: SilenceState.NO_TOOL,
    SilenceStatus.UNREADABLE: SilenceState.UNREADABLE,
}


_STALE_AUDIO: Final = "The audio changed. Find gaps again."


def find_silences_kind(clock: Clock, data_dir: Path) -> FindSilencesKind:
    """Return the kind of Job that finds where a Track's audio falls quiet."""
    return JobKind(
        name=FIND_SILENCES_KIND,
        program="medleyplay.programs.find_silences:FIND_SILENCES_PROGRAM",
        request=FindSilencesJob,
        result=FoundSilencesResult,
        complete=partial(_complete, clock=clock, folder=data_dir / DOWNLOADS_FOLDER),
        points=(SILENCE_FINDER.name,),
        refuse_start=partial(_refuse_stale, folder=data_dir / DOWNLOADS_FOLDER),
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
                    audio_kind="library" if audio.download_name is None else "download",
                    download_source_id=source_id if audio.download_name is not None else None,
                    download_name=audio.download_name,
                )
                self._jobs.submit(self._kind, find_silences_target(track_id), request, caller.id)
                return Silences(SilenceState.FINDING)
            case Preparing():
                return Silences(SilenceState.PREPARING)
            case _:
                message = "This file can't be played, so the gaps in it can't be found."
                raise ConflictError(message)


def _refuse_stale(db: Session, raw: object, *, folder: Path) -> str | None:
    request = FindSilencesJob.model_validate(raw)
    name = download_basename(folder, request.local_path)
    if name is None and request.download_source_id is None and request.download_name is None:
        if request.audio_kind == "library":
            return None
        site_source = db.scalar(
            select(SourceRow.id)
            .where(SourceRow.track_id == request.track_id, SourceRow.kind == BILIBILI_SOURCE)
            .limit(1)
        )
        return _STALE_AUDIO if site_source is not None or request.audio_kind == "download" else None
    if name is None or request.download_source_id is None or request.download_name != name:
        return _STALE_AUDIO
    download = db.get(DownloadRow, request.download_source_id)
    source = db.get(SourceRow, request.download_source_id)
    if (
        source is None
        or source.track_id != request.track_id
        or download is None
        or download.file_name != name
        or download.size != request.length
        or request.offset != 0
    ):
        return _STALE_AUDIO
    return None


def _complete(
    db: Session, job: Job, result: FoundSilencesResult, *, clock: Clock, folder: Path
) -> JobCompletion | None:
    """Keep the silences found, with the Track's length now, in place of any found before."""
    raw = db.get_one(JobRow, job.id).request
    if refusal := _refuse_stale(db, raw, folder=folder):
        return JobCompletion(failure=("refused", refusal))
    track = db.get(TrackRow, result.track_id)
    if track is None:
        return None
    row = db.get(SilenceRow, result.track_id) or SilenceRow(track_id=result.track_id)
    row.status = result.status.value
    row.silences = [{"start_ms": each.start_ms, "end_ms": each.end_ms} for each in result.silences]
    row.length_ms = track.duration_ms
    row.found_at = clock()
    db.add(row)
    return None
