"""Lyrics finders: the lyrics a site has for a song, found by its title and artist.

The core asks with a song's title and artist, as the household typed them, and its
length when known, and a lyrics finder answers with the songs it finds of that name,
each with its lyrics and what tells it apart, the closest in length first:

```text
ask      Melt, ryo, 4:20
answer   LRCLIB  Melt, ryo, Re:Start, 4:20, timed;
         LRCLIB  Melt (Acoustic), ryo, 4:31, plain
```

LRCLIB is searched first, then the sites the household turned on. Nothing changes a
song's lyrics until the household chooses some. The site refusing the request is a
reply, not a failure, so it doesn't count against the plugin.
"""

from datetime import timedelta
from typing import Annotated, Final, Protocol

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from medleyplay.plugin_api.artists import MAX_NAME, FindStatus, Name
from medleyplay.plugin_api.enrichers import MAX_LYRICS, LyricsProvider
from medleyplay.plugin_api.extension import ExtensionPoint

MAX_LYRICS_FOUND: Final = 8
"""The most songs a finder answers with."""

type Named = Annotated[str, StringConstraints(max_length=MAX_NAME)]


class _Model(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class FindLyrics(_Model):
    """Ask for the lyrics of the songs titled `title` by `artist`, `duration_ms` long.

    `artist` is empty when unknown, and `duration_ms` `None`. `sites` are the sites
    besides LRCLIB the household turned on, in the order to ask them.
    """

    title: Name
    artist: Named = ""
    duration_ms: Annotated[int, Field(ge=0)] | None = None
    sites: tuple[LyricsProvider, ...] = ()


class LyricsOption(_Model):
    """A song a site has, what tells it apart, and its lyrics.

    `text` is LRC or plain text, empty for a song that is instrumental.
    """

    provider: LyricsProvider
    title: Name
    artist: Named = ""
    album: Named = ""
    duration_ms: Annotated[int, Field(ge=0)] | None = None
    text: Annotated[str, StringConstraints(max_length=MAX_LYRICS)] = ""
    instrumental: bool = False

    @model_validator(mode="after")
    def _words_or_instrumental(self) -> "LyricsOption":
        if self.instrumental == bool(self.text.strip()):
            message = "A song found has words, or is instrumental, not both or neither."
            raise ValueError(message)
        return self


class FoundLyricsOptions(_Model):
    """The songs found with their lyrics, the closest first; none when the sites have none."""

    status: FindStatus = FindStatus.OK
    message: Annotated[str, StringConstraints(max_length=500)] = ""
    options: Annotated[tuple[LyricsOption, ...], Field(max_length=MAX_LYRICS_FOUND)] = ()


class LyricsFinder(Protocol):
    """Finds the lyrics the sites have for the songs of a title and artist."""

    def find(self, request: FindLyrics) -> FoundLyricsOptions:
        """Ask the sites for the songs of the title and artist, with their lyrics."""
        ...


LYRICS_FINDER = ExtensionPoint[LyricsFinder]("lyrics_finder")
FIND_LYRICS = LYRICS_FINDER.operation(
    "find",
    FindLyrics,
    FoundLyricsOptions,
    lambda finder: finder.find,
    deadline=timedelta(minutes=2),
)
