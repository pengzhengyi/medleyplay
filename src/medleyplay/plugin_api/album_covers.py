"""Cover finders and choosers: the covers a site has for an album, and which fits it.

The core asks with an album's name and artist, and a cover finder answers with the
front covers of the releases it finds of that album, best first, each written into a
folder the core owns, with what tells the releases apart:

```text
ask      OK Computer, Radiohead
answer   OK Computer (b1392450-…), 1997-05-21, GB, CD, 12 tracks, b1392450.jpg;
         OK Computer (0b6b4ba0-…), 2009-03-23, XE, CD, 24 tracks, 0b6b4ba0.jpg
```

A cover chooser is asked which of the releases offered is the album, given a few of
its songs, and answers with one of them, or none, and why:

```text
ask      OK Computer, Radiohead, songs: Airbag, Paranoid Android, …; the two above
answer   b1392450-…, "the original release, with the album's 12 songs"
```

The site refusing the request is a reply, not a failure, so it doesn't count
against the plugin.
"""

from datetime import timedelta
from typing import Annotated, Final, Protocol

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from medleyplay.plugin_api.artists import MAX_NAME, MAX_SONGS_SHOWN, FindStatus, Name
from medleyplay.plugin_api.enrichers import AiEndpoint
from medleyplay.plugin_api.extension import ExtensionPoint

MAX_COVERS: Final = 8
"""The most covers a finder answers with."""

type ReleaseId = Annotated[
    str,
    StringConstraints(pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"),
]
"""A release's MusicBrainz id."""

type MusicBrainzArtistId = Annotated[
    str,
    StringConstraints(pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"),
]
"""An artist's MusicBrainz id."""

MAX_ARTIST_IDS: Final = 8
"""The most MusicBrainz artists an album is searched by."""

MAX_TRIED: Final = 12
"""The most releases a finder asks for their cover, a second apart."""


class _Model(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class FindCovers(_Model):
    """Ask for the front covers of the releases of the album `album` by `artist`.

    `artist` is the album artist, or empty when the album has none; `artist_ids` are the
    MusicBrainz artists its songs are linked to, a finder that knows them searching by
    them rather than by `artist`. At most `tried` releases, the likeliest first, are asked
    for their cover. Each cover goes into `folder`, an empty folder the caller owns.
    """

    album: Name
    artist: Annotated[str, StringConstraints(max_length=MAX_NAME)] = ""
    artist_ids: Annotated[tuple[MusicBrainzArtistId, ...], Field(max_length=MAX_ARTIST_IDS)] = ()
    tried: Annotated[int, Field(ge=1, le=MAX_TRIED)] = MAX_TRIED
    folder: Annotated[str, StringConstraints(max_length=4096)] = ""


class CoverOption(_Model):
    """A release of an album, and what tells it apart from the others."""

    release_id: ReleaseId
    title: Name
    artist: Annotated[str, StringConstraints(max_length=MAX_NAME)] = ""
    date: Annotated[str, StringConstraints(max_length=10)] = ""
    """When it came out, as `1997`, `1997-05`, or `1997-05-21`; empty when unknown."""
    country: Annotated[str, StringConstraints(max_length=8)] = ""
    format: Annotated[str, StringConstraints(max_length=64)] = ""
    """Its media, such as `CD` or `Vinyl`."""
    tracks: Annotated[int, Field(ge=0, le=999)] | None = None


class FoundCover(CoverOption):
    """A release's front cover, written into the folder asked for as `file`, a bare name."""

    file: Annotated[str, StringConstraints(min_length=1, max_length=255, pattern=r"^[^/\\]+$")]


class FoundCovers(_Model):
    """The covers of the album's releases, best first; none when the site has none."""

    status: FindStatus = FindStatus.OK
    message: Annotated[str, StringConstraints(max_length=500)] = ""
    covers: Annotated[tuple[FoundCover, ...], Field(max_length=MAX_COVERS)] = ()


class CoverFinder(Protocol):
    """Finds the front covers a site has for an album."""

    def find(self, request: FindCovers) -> FoundCovers:
        """Ask the site for the covers of the album's releases."""
        ...


class ChooseCover(_Model):
    """Ask which of `options` is the album, of the AI providers `ai`, in turn."""

    album: Name
    artist: Annotated[str, StringConstraints(max_length=MAX_NAME)] = ""
    songs: Annotated[tuple[Name, ...], Field(max_length=MAX_SONGS_SHOWN)] = ()
    """Some of its songs, by title."""
    options: Annotated[tuple[CoverOption, ...], Field(min_length=1, max_length=MAX_COVERS)]
    ai: tuple[AiEndpoint, ...] = Field(default=(), repr=False)


class ChosenCover(_Model):
    """The release that is the album, or `None` for none of them, why, and who said so."""

    status: FindStatus = FindStatus.OK
    message: Annotated[str, StringConstraints(max_length=500)] = ""
    release_id: ReleaseId | None = None
    why: Annotated[str, StringConstraints(max_length=300)] = ""
    ai_answered: Annotated[str, StringConstraints(max_length=64)] = ""
    """The `id` of the provider that answered."""


class CoverChooser(Protocol):
    """Chooses which release of those offered is the album."""

    def choose(self, request: ChooseCover) -> ChosenCover:
        """Answer which option is the album, or none."""
        ...


COVER_FINDER = ExtensionPoint[CoverFinder]("cover_finder")
FIND_COVERS = COVER_FINDER.operation(
    "find",
    FindCovers,
    FoundCovers,
    lambda finder: finder.find,
    deadline=timedelta(minutes=3),
)

COVER_CHOOSER = ExtensionPoint[CoverChooser]("cover_chooser")
CHOOSE_COVER = COVER_CHOOSER.operation(
    "choose",
    ChooseCover,
    ChosenCover,
    lambda chooser: chooser.choose,
    deadline=timedelta(minutes=5),
)
