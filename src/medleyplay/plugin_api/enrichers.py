"""Track enrichers: asking a site what it knows about a Track the scan could not describe.

The core asks with what a Track shows now, and an enricher answers with values, or
with the text of the Track's video for the core to read, and may write one cover into
a folder the core owns:

```text
ask      BV1AC4y1L7Yi, shown: title "BV1AC4y1L7Yi" (file_name)
answer   video text "【HR 24/48】朴树2003《生如夏花》专辑歌词版", cover.jpg

ask      shown: title "Let Down" (files), artist "Radiohead" (files), 4:59
answer   title, artist, album "OK Computer", year 1997, track number 5, cover.jpg,
         ratings: the song 4.2 from 24 votes, the album 4.55 from 89
```

An ordinary *no*, such as a video that was removed or the site refusing the request,
is a reply, not a failure, so it doesn't count against the plugin.
"""

from datetime import timedelta
from enum import StrEnum
from typing import Annotated, Final, Protocol

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from medleyplay.plugin_api.extension import ExtensionPoint
from medleyplay.plugin_api.sources import ProxyUrl, Text, VideoId

MAX_VIDEO_TITLE: Final = 1_000
MAX_VIDEO_DESCRIPTION: Final = 20_000
MAX_CHAPTERS: Final = 1_000
MAX_SUGGESTED_SONGS: Final = 300
MAX_AI_PROVIDERS: Final = 5
MAX_HINT: Final = 500
"""The longest note a listener adds when asking the AI."""
MAX_RATINGS: Final = 2
"""A rating of the song, and one of its album."""
MAX_LINK: Final = 2_000

type FieldName = Annotated[str, StringConstraints(max_length=32)]
"""The name of one of a Track's details, such as `title`."""
type OriginName = Annotated[str, StringConstraints(max_length=32)]
"""The name of where a detail came from, such as `files`."""


class _Model(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class ShownDetail(_Model):
    """One detail a Track shows, and where it came from."""

    field: FieldName
    value: Annotated[str, StringConstraints(max_length=512)] | int
    origin: OriginName


class Chapter(_Model):
    """A chapter of a video: where it starts, in milliseconds, and its title."""

    start_ms: Annotated[int, Field(ge=0)]
    title: Annotated[str, StringConstraints(max_length=MAX_VIDEO_TITLE)]


class VideoText(_Model):
    """What a video says about itself, for the core to read with its one parser."""

    title: Annotated[str, StringConstraints(max_length=MAX_VIDEO_TITLE)] = ""
    description: Annotated[str, StringConstraints(max_length=MAX_VIDEO_DESCRIPTION)] = ""
    chapters: Annotated[tuple[Chapter, ...], Field(max_length=MAX_CHAPTERS)] = ()


class AiEndpoint(_Model):
    """An AI provider an enricher asks: which it is, where, which model to ask, and the key.

    The provider speaks the OpenAI chat protocol. `id` names it in what the enricher
    answers, and `key` is `None` for one that needs none, such as a local Ollama.
    """

    id: Annotated[str, StringConstraints(max_length=64)] = ""
    base_url: Annotated[str, StringConstraints(max_length=256)]
    model: Annotated[str, StringConstraints(max_length=128)]
    key: Annotated[str, StringConstraints(max_length=512)] | None = Field(default=None, repr=False)


class AiFailureKind(StrEnum):
    """Why an AI provider gave no answer to use."""

    UNREACHABLE = "unreachable"
    """It couldn't be reached, or something else answered in its place."""
    BUSY = "busy"
    """It stayed busy or kept failing."""
    REFUSED = "refused"
    """It refused the key or the account."""
    UNUSABLE = "unusable"
    """It answered, but not with what was asked: a wrong model or address, or a bad answer."""


class AiFailure(_Model):
    """An AI provider that was asked and gave no answer to use, and why."""

    provider: Annotated[str, StringConstraints(max_length=64)]
    kind: AiFailureKind


class EnrichTrack(_Model):
    """Ask what the site knows about a Track.

    `video` is the Track's video on its site, or `None` for a Track a site that reads
    no video is asked about. `shown` is what the Track shows now, except the values
    the enricher itself recorded, `duration_ms` its length when known, and `file_name`
    the name of its file, or empty. `whole_album` says the Track is a whole album, by
    the Kind the household sees: a file split into songs, one named an album, or one
    long enough to be guessed one. It is asked about as a release, never as one
    recording. A cover
    goes into `folder`, an empty folder the caller owns. `proxy` is the household's
    proxy for the site, or `None`. `text` is the Track's video text, for an enricher
    that reads it, and `ai` the providers an enricher that asks an AI model asks, the
    first first, each next one when the one before fails. `hint` is a note the listener
    added when asking the AI, on one line, or empty.
    """

    video: VideoId | None = None
    shown: tuple[ShownDetail, ...] = ()
    whole_album: bool = False
    duration_ms: Annotated[int, Field(ge=0)] | None = None
    file_name: Annotated[str, StringConstraints(max_length=255)] = ""
    folder: str
    proxy: ProxyUrl | None = Field(default=None, repr=False)
    text: VideoText | None = Field(default=None, repr=False)
    ai: Annotated[tuple[AiEndpoint, ...], Field(max_length=MAX_AI_PROVIDERS)] = Field(
        default=(), repr=False
    )
    hint: Annotated[str, StringConstraints(max_length=MAX_HINT)] = Field(default="", repr=False)


class EnrichStatus(StrEnum):
    """Whether the site answered."""

    OK = "ok"
    GONE = "gone"
    """The video is removed, region-locked, or private."""
    REFUSED = "refused"
    """The site refused the request; nothing more should be asked of it."""
    INVALID = "invalid"
    """The site answered, but not in a way the enricher can use."""


class SuggestedSong(_Model):
    """A song of a suggested song list: where it starts, in milliseconds, its title and artist."""

    start_ms: Annotated[int, Field(ge=0)]
    title: Annotated[str, StringConstraints(max_length=512)]
    artist: Annotated[str, StringConstraints(max_length=512)] = ""


class RatedAs(StrEnum):
    """What listeners rated: the song itself, or the album it is on."""

    SONG = "song"
    ALBUM = "album"


class CommunityRating(_Model):
    """What listeners on a site rated a song or its album: the mean of their stars, out of 5.

    `link` is the site's page of what was rated, where the rating can be read.
    """

    of: RatedAs
    value: Annotated[float, Field(ge=0, le=5)]
    votes: Annotated[int, Field(ge=1)]
    link: Annotated[str, StringConstraints(max_length=MAX_LINK)]


class Enriched(_Model):
    """What the site said, or why it said nothing.

    With `OK`, `values` are details by field name, and `video_text` is the video's
    own text for the core to read instead of values; an answer holds one or the other.
    `songs` is a song list the enricher suggests, beside the values. `cover` is the
    bare name of an image the enricher wrote into the folder. `ratings` are what the
    site's listeners rated the song and its album, beside the values. An enricher that asks AI
    providers names in `ai_answered` the one whose answer it used, and lists in
    `ai_failures` each one asked before it that gave none.
    """

    status: EnrichStatus = EnrichStatus.OK
    message: Text = ""
    values: dict[FieldName, Annotated[str, StringConstraints(max_length=512)] | int] = {}
    video_text: VideoText | None = None
    songs: Annotated[tuple[SuggestedSong, ...], Field(max_length=MAX_SUGGESTED_SONGS)] = ()
    cover: Annotated[str, StringConstraints(max_length=255)] | None = None
    ratings: Annotated[tuple[CommunityRating, ...], Field(max_length=MAX_RATINGS)] = ()
    ai_answered: Annotated[str, StringConstraints(max_length=64)] | None = None
    ai_failures: Annotated[tuple[AiFailure, ...], Field(max_length=MAX_AI_PROVIDERS)] = ()

    @model_validator(mode="after")
    def _one_kind_of_answer(self) -> "Enriched":
        if self.values and self.video_text is not None:
            message = "An answer holds values or the video's text, not both."
            raise ValueError(message)
        return self


class TrackEnricher(Protocol):
    """Finds details for a Track from one place."""

    def enrich(self, request: EnrichTrack) -> Enriched:
        """Ask the site about the Track's video."""
        ...


TRACK_ENRICHER = ExtensionPoint[TrackEnricher]("track_enricher")
ENRICH_TRACK = TRACK_ENRICHER.operation(
    "enrich",
    EnrichTrack,
    Enriched,
    lambda enricher: enricher.enrich,
    deadline=timedelta(minutes=2),
)
