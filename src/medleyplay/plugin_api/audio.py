"""The silence finder: where a file's audio falls quiet, such as the gaps between songs.

Asked with a file, a finder answers with each quiet stretch in it, in order:

```text
ask      /Music/Bilibili/BV14m411Q7Kn.m4a, a whole album in one file
answer   246.3 s to 247.7 s, 542.2 s to 545.8 s, 1014.0 s to 1020.6 s, …
```
"""

from datetime import timedelta
from enum import StrEnum
from typing import Annotated, Final, Protocol

from pydantic import BaseModel, ConfigDict, Field

from medleyplay.plugin_api.extension import ExtensionPoint

MAX_SILENCES: Final = 5000
"""The most quiet stretches a finder answers with."""


class _Model(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class FindSilences(_Model):
    """Find the quiet stretches in the bytes at `local_path`, from `offset`, for `length` if given.

    The offset and length pick a member stored inside a zip archive.
    """

    local_path: str
    offset: Annotated[int, Field(ge=0)] = 0
    length: Annotated[int, Field(gt=0)] | None = None


class Silence(_Model):
    """A quiet stretch of the audio, from `start_ms` to `end_ms`."""

    start_ms: Annotated[int, Field(ge=0)]
    end_ms: Annotated[int, Field(ge=0)]


class SilenceStatus(StrEnum):
    """How the finder answered."""

    OK = "ok"
    NO_TOOL = "no_tool"
    """The program the finder runs isn't installed."""
    UNREADABLE = "unreadable"
    """The program couldn't read the file as audio."""


class FoundSilences(_Model):
    """The quiet stretches in the file, in order; none when it has none or can't be read."""

    status: SilenceStatus = SilenceStatus.OK
    silences: Annotated[tuple[Silence, ...], Field(max_length=MAX_SILENCES)] = ()


class SilenceFinder(Protocol):
    """Finds the quiet stretches in an audio file."""

    def find_silences(self, request: FindSilences) -> FoundSilences:
        """Find the file's quiet stretches."""
        ...


SILENCE_FINDER = ExtensionPoint[SilenceFinder]("silence_finder")
FIND_SILENCES = SILENCE_FINDER.operation(
    "find_silences",
    FindSilences,
    FoundSilences,
    lambda finder: finder.find_silences,
    deadline=timedelta(minutes=5),
)
