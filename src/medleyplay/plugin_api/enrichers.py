"""Track enrichers: asking a site what it knows about a Track the scan could not describe.

The core asks with what a Track shows now, and an enricher answers with values, or
with the text of the Track's video for the core to read, and may write one cover into
a folder the core owns:

```text
ask      BV1AC4y1L7Yi, shown: title "BV1AC4y1L7Yi" (file_name)
answer   video text "【HR 24/48】朴树2003《生如夏花》专辑歌词版", cover.jpg
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


class EnrichTrack(_Model):
    """Ask what the site knows about the Track whose video is `video`.

    `shown` is what the Track shows now, `duration_ms` its length when known, and
    `file_name` the name of its file, or empty. A cover goes into `folder`, an empty
    folder the caller owns. `proxy` is the household's proxy for the site, or `None`.
    """

    video: VideoId
    shown: tuple[ShownDetail, ...] = ()
    duration_ms: Annotated[int, Field(ge=0)] | None = None
    file_name: Annotated[str, StringConstraints(max_length=255)] = ""
    folder: str
    proxy: ProxyUrl | None = Field(default=None, repr=False)


class Chapter(_Model):
    """A chapter of a video: where it starts, in milliseconds, and its title."""

    start_ms: Annotated[int, Field(ge=0)]
    title: Annotated[str, StringConstraints(max_length=MAX_VIDEO_TITLE)]


class VideoText(_Model):
    """What a video says about itself, for the core to read with its one parser."""

    title: Annotated[str, StringConstraints(max_length=MAX_VIDEO_TITLE)] = ""
    description: Annotated[str, StringConstraints(max_length=MAX_VIDEO_DESCRIPTION)] = ""
    chapters: Annotated[tuple[Chapter, ...], Field(max_length=MAX_CHAPTERS)] = ()


class EnrichStatus(StrEnum):
    """Whether the site answered."""

    OK = "ok"
    GONE = "gone"
    """The video is removed, region-locked, or private."""
    REFUSED = "refused"
    """The site refused the request; nothing more should be asked of it."""


class Enriched(_Model):
    """What the site said, or why it said nothing.

    With `OK`, `values` are details by field name, and `video_text` is the video's
    own text for the core to read instead of values; an answer holds one or the other.
    `cover` is the bare name of an image the enricher wrote into the folder.
    """

    status: EnrichStatus = EnrichStatus.OK
    message: Text = ""
    values: dict[FieldName, Annotated[str, StringConstraints(max_length=512)] | int] = {}
    video_text: VideoText | None = None
    cover: Annotated[str, StringConstraints(max_length=255)] | None = None

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
