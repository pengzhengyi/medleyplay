"""The program that asks an artist finder which artists go by a name."""

from typing import Annotated

from pydantic import BaseModel, ConfigDict, StringConstraints

from medleyplay.plugin_api import FIND_ARTIST, FindArtist, FindStatus, FoundArtist
from medleyplay.plugin_host.job import AnswerFailedError, JobContext, JobProgram


class _Model(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class FindArtistJob(_Model):
    """Ask `finder` which artists go by `name`, the name as Tracks show it."""

    name: Annotated[str, StringConstraints(min_length=1, max_length=512)]
    finder: Annotated[str, StringConstraints(max_length=64)] = "musicbrainz"


class FoundArtistsResult(_Model):
    """The artists the finder knows by the Job's name, best first."""

    name: str
    finder: str
    artists: tuple[FoundArtist, ...] = ()


def run(request: FindArtistJob, context: JobContext) -> FoundArtistsResult:
    """Ask the finder, and fail the Job if the site refuses."""
    answer = context.call(FIND_ARTIST, request.finder, FindArtist(name=request.name))
    if answer.status is FindStatus.REFUSED:
        raise AnswerFailedError(answer.message or "The site refused the request.", kind="refused")
    return FoundArtistsResult(name=request.name, finder=request.finder, artists=answer.artists)


FIND_ARTIST_PROGRAM: JobProgram[FindArtistJob, FoundArtistsResult] = JobProgram(
    FindArtistJob, FoundArtistsResult, run
)
