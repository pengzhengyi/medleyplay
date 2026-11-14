"""The program that asks an artist finder which artists go by a name."""

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from medleyplay.plugin_api import FIND_ARTIST, MAX_ARTISTS, FindArtist, FindStatus, FoundArtist
from medleyplay.plugin_host.job import AnswerFailedError, JobContext, JobProgram


class _Model(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


type _Name = Annotated[str, StringConstraints(min_length=1, max_length=512)]


class FindArtistJob(_Model):
    """Ask `finder` which artists go by `name`, the name as Tracks show it, by each query.

    The queries are the name itself and, for a name written as several, each of them.
    """

    name: _Name
    queries: Annotated[tuple[_Name, ...], Field(min_length=1, max_length=4)]
    finder: Annotated[str, StringConstraints(max_length=64)] = "musicbrainz"


class FoundArtistsResult(_Model):
    """The artists the finder knows by the Job's name, best first."""

    name: str
    finder: str
    artists: Annotated[tuple[FoundArtist, ...], Field(max_length=MAX_ARTISTS)] = ()


def run(request: FindArtistJob, context: JobContext) -> FoundArtistsResult:
    """Ask the finder by each query, and fail the Job if the site refuses.

    An artist found by several queries is kept once, with its best score; the artists
    come best first.
    """
    found: dict[str, FoundArtist] = {}
    for query in request.queries:
        answer = context.call(FIND_ARTIST, request.finder, FindArtist(name=query))
        if answer.status is FindStatus.REFUSED:
            message = answer.message or "The site refused the request."
            raise AnswerFailedError(message, kind="refused")
        for artist in answer.artists:
            known = found.get(artist.id)
            if known is None or artist.score > known.score:
                found[artist.id] = artist
    best = sorted(found.values(), key=lambda artist: -artist.score)[:MAX_ARTISTS]
    return FoundArtistsResult(name=request.name, finder=request.finder, artists=tuple(best))


FIND_ARTIST_PROGRAM: JobProgram[FindArtistJob, FoundArtistsResult] = JobProgram(
    FindArtistJob, FoundArtistsResult, run
)
