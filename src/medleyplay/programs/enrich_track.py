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

from typing import Final

from pydantic import BaseModel, ConfigDict

from medleyplay.plugin_api import (
    ENRICH_TRACK,
    AiFailure,
    CommunityRating,
    EnrichStatus,
    EnrichTrack,
    FoundLyrics,
    LyricsProvider,
    ShownDetail,
    SuggestedSong,
    VideoId,
    VideoText,
)
from medleyplay.plugin_host.job import AnswerFailedError, JobContext, JobProgram
from medleyplay.programs.scan_covers import CoverFile, copy_written

ENRICH_FOLDER: Final = "enrich"


class _Model(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class EnrichJob(_Model):
    """Ask the enricher `enricher` about a Track.

    `subject` is what the enricher is asked about, which is noted as asked once the Job
    has run: the Track's video, or a key made from the Track and what it is searched
    for. `video` is the Track's video, when the enricher reads videos. `shown` is what
    the Track showed when the Job was queued, and `whole_album` says it is a whole album,
    by its Kind. `text` is the Track's video text, when the enricher reads it, and
    `hint` a note the listener added when asking the AI again. `lyrics_sites` are the
    sites the household turned on to be asked for lyrics after LRCLIB, and
    `suggest_lyrics` whether a song none has is given the nearest song's, suggested.
    `lyrics_again` records an explicit request to look up lyrics again.
    """

    enricher: str
    subject: str
    video: VideoId | None = None
    shown: tuple[ShownDetail, ...] = ()
    duration_ms: int | None = None
    file_name: str = ""
    whole_album: bool = False
    text: VideoText | None = None
    hint: str = ""
    lyrics_sites: tuple[LyricsProvider, ...] = ()
    suggest_lyrics: bool = False
    lyrics_again: bool = False


class EnrichedTrack(_Model):
    """What the enricher found: values and songs, or the video's text, and a copy of its cover.

    `ratings` are what the site's listeners rated the song and its album. `ai_answered`
    and `ai_failures` say which AI provider answered and which failed first. `lyrics`
    are the song's lyrics, from an enricher that finds them.
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
    lyrics: FoundLyrics | None = None


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
            hint=request.hint,
            lyrics_sites=request.lyrics_sites,
            suggest_lyrics=request.suggest_lyrics,
        ),
    )
    if answer.status is EnrichStatus.REFUSED:
        raise AnswerFailedError(answer.message or "The site refused the request.", kind="refused")
    if answer.status is EnrichStatus.GONE:
        raise AnswerFailedError(answer.message or "The site no longer has the video.", kind="gone")
    if answer.status is EnrichStatus.INVALID:
        raise AnswerFailedError(answer.message or "The answer was not usable.", kind="invalid")
    copy = None if answer.cover is None else copy_written(folder, answer.cover, context.work_dir)
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
        lyrics=answer.lyrics,
    )


ENRICH_TRACK_PROGRAM: JobProgram[EnrichJob, EnrichedTrack] = JobProgram(
    EnrichJob, EnrichedTrack, run
)
