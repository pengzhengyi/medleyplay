"""The programs that find an album's covers on a site, and ask an AI model which fits it.

The cover finder writes each cover into `covers/`, a folder of its own, and the program
copies each as an enricher's cover is copied, so the result holds no image bytes.
"""

from typing import Annotated, Final

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from medleyplay.plugin_api import (
    CHOOSE_COVER,
    FIND_COVERS,
    MAX_ARTIST_IDS,
    MAX_COVERS,
    MAX_NAME,
    MAX_SONGS_SHOWN,
    MAX_TRIED,
    ChooseCover,
    CoverOption,
    FindCovers,
    FindStatus,
    MusicBrainzArtistId,
    ReleaseId,
)
from medleyplay.plugin_host.job import AnswerFailedError, JobContext, JobProgram
from medleyplay.programs.scan_covers import CoverFile, copy_written

COVERS_FOLDER: Final = "covers"
"""Where the cover finder writes the covers, in the Job's working folder."""

type _Name = Annotated[str, StringConstraints(min_length=1, max_length=MAX_NAME)]
type _Artist = Annotated[str, StringConstraints(max_length=MAX_NAME)]


class _Model(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class FindCoversJob(_Model):
    """Ask `finder` for the covers of the album `album` by `artist`, empty for none.

    `artist_ids` are the MusicBrainz artists the album's songs are linked to, and `tried`
    the most releases asked for their cover.
    """

    album: _Name
    artist: _Artist = ""
    artist_ids: Annotated[tuple[MusicBrainzArtistId, ...], Field(max_length=MAX_ARTIST_IDS)] = ()
    tried: Annotated[int, Field(ge=1, le=MAX_TRIED)] = MAX_TRIED
    finder: Annotated[str, StringConstraints(max_length=64)] = "musicbrainz"


class FoundCoverCopy(_Model):
    """A release of the album, and a copy of its front cover."""

    option: CoverOption
    cover: CoverFile


class FoundCoversResult(_Model):
    """The album's covers the finder found, best first, each a copy."""

    album: str
    artist: str
    covers: Annotated[tuple[FoundCoverCopy, ...], Field(max_length=MAX_COVERS)] = ()


def run(request: FindCoversJob, context: JobContext) -> FoundCoversResult:
    """Ask the finder, and fail the Job if the site refuses.

    A cover that is no plain image directly in the folder is left out.
    """
    folder = context.work_dir / COVERS_FOLDER
    folder.mkdir(exist_ok=True)
    answer = context.call(
        FIND_COVERS,
        request.finder,
        FindCovers(
            album=request.album,
            artist=request.artist,
            artist_ids=request.artist_ids,
            tried=request.tried,
            folder=str(folder),
        ),
    )
    if answer.status is FindStatus.REFUSED:
        message = answer.message or "The site refused the request."
        raise AnswerFailedError(message, kind="refused")
    copies: list[FoundCoverCopy] = []
    for found in answer.covers:
        copy = copy_written(folder, found.file, context.work_dir)
        if copy is not None:
            option = CoverOption.model_validate(found.model_dump(exclude={"file"}))
            copies.append(FoundCoverCopy(option=option, cover=copy))
    return FoundCoversResult(album=request.album, artist=request.artist, covers=tuple(copies))


FIND_COVERS_PROGRAM: JobProgram[FindCoversJob, FoundCoversResult] = JobProgram(
    FindCoversJob, FoundCoversResult, run
)


class ChooseCoverJob(_Model):
    """Ask `chooser` which of `options` is the album `album` by `artist`, with a few songs."""

    album: _Name
    artist: _Artist = ""
    songs: Annotated[tuple[_Name, ...], Field(max_length=MAX_SONGS_SHOWN)] = ()
    options: Annotated[tuple[CoverOption, ...], Field(min_length=1, max_length=MAX_COVERS)]
    chooser: Annotated[str, StringConstraints(max_length=64)] = "ai-details"


class ChosenCoverResult(_Model):
    """The release chosen of those offered, or none, why, and the provider that answered."""

    offered: Annotated[tuple[ReleaseId, ...], Field(max_length=MAX_COVERS)]
    release_id: ReleaseId | None = None
    why: Annotated[str, StringConstraints(max_length=300)] = ""
    ai_answered: Annotated[str, StringConstraints(max_length=64)] = ""


def run_choice(request: ChooseCoverJob, context: JobContext) -> ChosenCoverResult:
    """Ask the chooser with the providers the Job is lent, and fail if the provider refuses.

    A release chosen that was not offered is no choice.
    """
    asking = ChooseCover(
        album=request.album,
        artist=request.artist,
        songs=request.songs,
        options=request.options,
        ai=context.ai,
    )
    answer = context.call(CHOOSE_COVER, request.chooser, asking)
    if answer.status is FindStatus.REFUSED:
        message = answer.message or "The AI provider refused the request."
        raise AnswerFailedError(message, kind="refused")
    offered = tuple(option.release_id for option in request.options)
    chosen = answer.release_id if answer.release_id in offered else None
    return ChosenCoverResult(
        offered=offered,
        release_id=chosen,
        why=answer.why if chosen is not None else "",
        ai_answered=answer.ai_answered,
    )


CHOOSE_COVER_PROGRAM: JobProgram[ChooseCoverJob, ChosenCoverResult] = JobProgram(
    ChooseCoverJob, ChosenCoverResult, run_choice
)
