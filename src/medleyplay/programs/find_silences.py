"""The program that asks a silence finder where a file's audio falls quiet."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from medleyplay.plugin_api import (
    FIND_SILENCES,
    MAX_SILENCES,
    FindSilences,
    Silence,
    SilenceStatus,
)
from medleyplay.plugin_host.job import JobContext, JobProgram


class _Model(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class FindSilencesJob(_Model):
    """Ask `finder` for the quiet stretches of the Track `track_id`'s audio, at `local_path`.

    The audio is `length` bytes from `offset`, as for a member stored in a zip archive.
    """

    track_id: int
    local_path: str
    offset: Annotated[int, Field(ge=0)] = 0
    length: Annotated[int, Field(gt=0)] | None = None
    finder: Annotated[str, Field(max_length=64)] = "ffmpeg"
    audio_kind: Literal["download", "library"] | None = None
    download_source_id: Annotated[int, Field(gt=0)] | None = None
    download_name: Annotated[str, Field(max_length=255)] | None = None


class FoundSilencesResult(_Model):
    """The quiet stretches in the Track's audio, in order, and how the finder answered."""

    track_id: int
    status: SilenceStatus
    silences: Annotated[tuple[Silence, ...], Field(max_length=MAX_SILENCES)] = ()


def run(request: FindSilencesJob, context: JobContext) -> FoundSilencesResult:
    """Ask the finder about the file."""
    found = context.call(
        FIND_SILENCES,
        request.finder,
        FindSilences(local_path=request.local_path, offset=request.offset, length=request.length),
    )
    return FoundSilencesResult(
        track_id=request.track_id, status=found.status, silences=found.silences
    )


FIND_SILENCES_PROGRAM: JobProgram[FindSilencesJob, FoundSilencesResult] = JobProgram(
    FindSilencesJob, FoundSilencesResult, run
)
