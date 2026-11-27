"""Lyrics finders: the lyrics a site has for a song, found by its title and artist.

The core asks with a song's title and artist, as the household typed them, and its
length when known, and a lyrics finder answers with the songs it finds of that name,
each with its lyrics and what tells it apart, the closest in length first:

```text
ask      Melt, ryo, 4:20
answer   LRCLIB  Melt, ryo, Re:Start, 4:20, timed;
         LRCLIB  Melt (Acoustic), ryo, 4:31, plain
```

LRCLIB is searched first, then the sites the household turned on. A lyrics chooser
is asked which of the songs found is the song, shown what tells each apart and never
its words, and answers with one, or none, and why:

```text
ask      Melt, ryo, Re:Start, 4:20; the two above
answer   0, "the studio recording, as long as the file"
```

Nothing changes a song's lyrics until the household chooses some. The site refusing
the request is a reply, not a failure, so it doesn't count against the plugin.
"""

from datetime import timedelta
from typing import Annotated, Final, Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from medleyplay.plugin_api.artists import MAX_NAME, FindStatus, Name
from medleyplay.plugin_api.enrichers import MAX_LYRICS, AiEndpoint, LyricsProvider
from medleyplay.plugin_api.extension import ExtensionPoint

MAX_LYRICS_FOUND: Final = 8
"""The most songs a finder answers with."""

type Named = Annotated[str, StringConstraints(max_length=MAX_NAME)]
type LyricsInterfaceLanguage = Literal["en", "zh-Hans"]
type LyricLanguageHint = Literal["en", "ja", "ko", "zh-Hans"]


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


class LyricsChoice(_Model):
    """A song found, offered to choose from by what tells it apart, without its words.

    `timed` says its lyrics are LRC, timed line by line.
    The language hints describe the primary text and its paired lines, when recognizable.
    """

    provider: LyricsProvider
    title: Name
    artist: Named = ""
    album: Named = ""
    duration_ms: Annotated[int, Field(ge=0)] | None = None
    timed: bool = False
    instrumental: bool = False
    lyrics_language: LyricLanguageHint | None = None
    translation_language: LyricLanguageHint | None = None
    has_paired_text: bool = False


class ChooseLyrics(_Model):
    """Ask which of `options` is the song `title` by `artist`, of the AI providers `ai`, in turn.

    `album` is the song's album, empty for none, and `duration_ms` its length, when known.
    """

    title: Name
    artist: Named = ""
    album: Named = ""
    duration_ms: Annotated[int, Field(ge=0)] | None = None
    options: Annotated[tuple[LyricsChoice, ...], Field(min_length=1, max_length=MAX_LYRICS_FOUND)]
    ai: tuple[AiEndpoint, ...] = Field(default=(), repr=False)
    interface_language: LyricsInterfaceLanguage | None = None


class ChosenLyrics(_Model):
    """The option, by its place among those offered, that is the song, or `None`, and why."""

    status: FindStatus = FindStatus.OK
    message: Annotated[str, StringConstraints(max_length=500)] = ""
    option: Annotated[int, Field(ge=0, lt=MAX_LYRICS_FOUND)] | None = None
    why: Annotated[str, StringConstraints(max_length=300)] = ""
    ai_answered: Annotated[str, StringConstraints(max_length=64)] = ""
    """The `id` of the provider that answered."""


class LyricsChooser(Protocol):
    """Chooses which of the songs found is the song."""

    def choose(self, request: ChooseLyrics) -> ChosenLyrics:
        """Answer which option is the song, or none."""
        ...


LYRICS_CHOOSER = ExtensionPoint[LyricsChooser]("lyrics_chooser")
CHOOSE_LYRICS = LYRICS_CHOOSER.operation(
    "choose",
    ChooseLyrics,
    ChosenLyrics,
    lambda chooser: chooser.choose,
    deadline=timedelta(minutes=5),
)
