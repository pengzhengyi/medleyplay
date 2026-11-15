"""The programs that ask which artists go by a name, and every name an artist goes by.

The name finder writes the artist's photo into `photo/`, a folder of its own, and
the program copies it as an enricher's cover is copied, so the result holds no image
bytes.
"""

from typing import Annotated, Final

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from medleyplay.plugin_api import (
    FIND_ARTIST,
    FIND_ARTIST_NAMES,
    MAX_ALIASES,
    MAX_ARTISTS,
    ArtistAlias,
    FindArtist,
    FindArtistNames,
    FindStatus,
    FoundArtist,
    Page,
)
from medleyplay.plugin_host.job import AnswerFailedError, JobContext, JobProgram
from medleyplay.programs.scan_covers import CoverFile, copy_written

PHOTO_FOLDER: Final = "photo"
"""Where the name finder writes the artist's photo, in the Job's working folder."""


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


class FindArtistNamesJob(_Model):
    """Ask `finder` every name the artist `artist_id`, a MusicBrainz id, goes by."""

    artist_id: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    finder: Annotated[str, StringConstraints(max_length=64)] = "wikipedia"


class FoundArtistNamesResult(_Model):
    """Every name the finder knows the artist by; none when it doesn't know it.

    `page` is the artist's page on the finder's site, and `photo` a copy of the photo
    it gave, with `photo_page`, where the photo comes from.
    """

    artist_id: str
    finder: str
    aliases: Annotated[tuple[ArtistAlias, ...], Field(max_length=MAX_ALIASES)] = ()
    page: Page | None = None
    photo: CoverFile | None = None
    photo_page: Page | None = None


def run_names(request: FindArtistNamesJob, context: JobContext) -> FoundArtistNamesResult:
    """Ask the finder, and fail the Job if the site refuses."""
    folder = context.work_dir / PHOTO_FOLDER
    folder.mkdir(exist_ok=True)
    answer = context.call(
        FIND_ARTIST_NAMES,
        request.finder,
        FindArtistNames(musicbrainz_id=request.artist_id, folder=str(folder)),
    )
    if answer.status is FindStatus.REFUSED:
        message = answer.message or "The site refused the request."
        raise AnswerFailedError(message, kind="refused")
    photo = None if answer.photo is None else copy_written(folder, answer.photo, context.work_dir)
    return FoundArtistNamesResult(
        artist_id=request.artist_id,
        finder=request.finder,
        aliases=answer.aliases,
        page=answer.page,
        photo=photo,
        photo_page=None if photo is None else answer.photo_page,
    )


FIND_ARTIST_NAMES_PROGRAM: JobProgram[FindArtistNamesJob, FoundArtistNamesResult] = JobProgram(
    FindArtistNamesJob, FoundArtistNamesResult, run_names
)
