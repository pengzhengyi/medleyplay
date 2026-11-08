"""The program that asks an enricher about one Track, and checks the cover it wrote.

The enricher writes its cover into `enrich/`, a folder of its own, and names the file;
the program trusts the name only once the file proves to be a plain image directly in
that folder, then copies it under the SHA-256 of its bytes as a scan copies the images
it reads, so the result holds no image bytes:

```text
<work>/enrich/cover      the file the enricher wrote
<work>/covers/9f2c...    the copy the result reports
```
"""

import os
import stat
from pathlib import Path, PurePosixPath
from typing import Final

from pydantic import BaseModel, ConfigDict

from medleyplay.plugin_api import (
    ENRICH_TRACK,
    MAX_COVER_BYTES,
    AiFailure,
    CommunityRating,
    EnrichStatus,
    EnrichTrack,
    ShownDetail,
    SuggestedSong,
    VideoId,
    VideoText,
    is_cover_image,
)
from medleyplay.plugin_host.job import AnswerFailedError, JobContext, JobProgram
from medleyplay.programs.scan_covers import COPIES_FOLDER, CopyFolder, CoverFile

ENRICH_FOLDER: Final = "enrich"
_OPEN_FLAGS: Final = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK


class _Model(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class EnrichJob(_Model):
    """Ask the enricher `enricher` about a Track.

    `subject` is what the enricher is asked about, which is noted as asked once the Job
    has run: the Track's video, or a key made from the Track and what it is searched
    for. `video` is the Track's video, when the enricher reads videos. `shown` is what
    the Track showed when the Job was queued, and `whole_album` says it is a whole album,
    by its Kind. `text` is the Track's video text, when the enricher reads it.
    """

    enricher: str
    subject: str
    video: VideoId | None = None
    shown: tuple[ShownDetail, ...] = ()
    duration_ms: int | None = None
    file_name: str = ""
    whole_album: bool = False
    text: VideoText | None = None


class EnrichedTrack(_Model):
    """What the enricher found: values and songs, or the video's text, and a copy of its cover.

    `ratings` are what the site's listeners rated the song and its album. `ai_answered`
    and `ai_failures` say which AI provider answered and which failed first.
    """

    enricher: str
    subject: str
    values: dict[str, str | int] = {}
    video_text: VideoText | None = None
    songs: tuple[SuggestedSong, ...] = ()
    ratings: tuple[CommunityRating, ...] = ()
    cover: CoverFile | None = None
    ai_answered: str | None = None
    ai_failures: tuple[AiFailure, ...] = ()


def run(request: EnrichJob, context: JobContext) -> EnrichedTrack:
    """Ask the enricher with the Job's proxy, and fail the Job if the site says no."""
    folder = context.work_dir / ENRICH_FOLDER
    folder.mkdir(exist_ok=True)
    answer = context.call(
        ENRICH_TRACK,
        request.enricher,
        EnrichTrack(
            video=request.video,
            shown=request.shown,
            whole_album=request.whole_album,
            duration_ms=request.duration_ms,
            file_name=request.file_name,
            folder=str(folder),
            proxy=context.proxy,
            text=request.text,
            ai=context.ai,
        ),
    )
    if answer.status is EnrichStatus.REFUSED:
        raise AnswerFailedError(answer.message or "The site refused the request.", kind="refused")
    if answer.status is EnrichStatus.GONE:
        raise AnswerFailedError(answer.message or "The site no longer has the video.", kind="gone")
    if answer.status is EnrichStatus.INVALID:
        raise AnswerFailedError(answer.message or "The answer was not usable.", kind="invalid")
    copy = None if answer.cover is None else _copy_cover(folder, answer.cover, context.work_dir)
    return EnrichedTrack(
        enricher=request.enricher,
        subject=request.subject,
        values=answer.values,
        video_text=answer.video_text,
        songs=answer.songs,
        ratings=answer.ratings,
        cover=copy,
        ai_answered=answer.ai_answered,
        ai_failures=answer.ai_failures,
    )


def _copy_cover(folder: Path, name: str, work_dir: Path) -> CoverFile | None:
    """Return a copy of the cover the enricher named, or `None` when it is no cover."""
    if PurePosixPath(name).name != name or name in {".", ".."} or "\\" in name:
        return None
    try:
        descriptor = os.open(folder / name, _OPEN_FLAGS)
    except OSError:
        return None
    if not stat.S_ISREG(os.fstat(descriptor).st_mode):
        os.close(descriptor)
        return None
    with os.fdopen(descriptor, "rb") as file:
        data = file.read(MAX_COVER_BYTES + 1)
    if len(data) > MAX_COVER_BYTES or not is_cover_image(data):
        return None
    return CopyFolder(work_dir / COPIES_FOLDER).keep(data)


ENRICH_TRACK_PROGRAM: JobProgram[EnrichJob, EnrichedTrack] = JobProgram(
    EnrichJob, EnrichedTrack, run
)
