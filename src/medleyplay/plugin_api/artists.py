"""Artist finders: asking a site which artists go by a name, and every name each goes by.

The core asks with a name as Tracks show it, and a finder answers with the artists
it knows by that name, best first, each with its other names:

```text
ask      披头士
answer   The Beatles (b10bbbfc-…), UK, Liverpool rock band, score 100;
         also 披头士 (zh), 披頭四 (zh_Hant), Beatles
```

The site refusing the request is a reply, not a failure, so it doesn't count
against the plugin.
"""

from datetime import timedelta
from enum import StrEnum
from typing import Annotated, Final, Protocol

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from medleyplay.plugin_api.extension import ExtensionPoint

MAX_NAME: Final = 512
MAX_ARTISTS: Final = 10
"""The most artists a finder answers with."""
MAX_ALIASES: Final = 100
"""The most other names kept of one artist."""

type Name = Annotated[str, StringConstraints(min_length=1, max_length=MAX_NAME)]


class _Model(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class FindArtist(_Model):
    """Ask which artists go by `name`."""

    name: Name


class ArtistAlias(_Model):
    """Another name an artist goes by, and the language it is written for, if one."""

    name: Name
    locale: Annotated[str, StringConstraints(max_length=16)] | None = None
    primary: bool = False
    """The name the site gives first for its locale."""


class FoundArtist(_Model):
    """An artist a site knows by the name asked for."""

    id: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    """The site's id for the artist, such as a MusicBrainz id."""
    name: Name
    sort_name: Annotated[str, StringConstraints(max_length=MAX_NAME)] = ""
    disambiguation: Annotated[str, StringConstraints(max_length=MAX_NAME)] = ""
    """What tells it apart from others of its name, such as *Liverpool rock band*."""
    country: Annotated[str, StringConstraints(max_length=8)] = ""
    score: Annotated[int, Field(ge=0, le=100)] = 0
    """How well the site says it matches the name asked for."""
    aliases: Annotated[tuple[ArtistAlias, ...], Field(max_length=MAX_ALIASES)] = ()


class FindStatus(StrEnum):
    """How the site answered."""

    OK = "ok"
    REFUSED = "refused"
    """The site refused the request; no more should be asked of it for now."""


class FoundArtists(_Model):
    """The artists a site knows by the name, best first; none when it knows none."""

    status: FindStatus = FindStatus.OK
    message: Annotated[str, StringConstraints(max_length=500)] = ""
    artists: Annotated[tuple[FoundArtist, ...], Field(max_length=MAX_ARTISTS)] = ()


class ArtistFinder(Protocol):
    """Finds the artists a site knows by a name."""

    def find(self, request: FindArtist) -> FoundArtists:
        """Ask the site which artists go by the name."""
        ...


ARTIST_FINDER = ExtensionPoint[ArtistFinder]("artist_finder")
FIND_ARTIST = ARTIST_FINDER.operation(
    "find",
    FindArtist,
    FoundArtists,
    lambda finder: finder.find,
    deadline=timedelta(minutes=1),
)
