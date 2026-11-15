"""Artist finders: asking a site which artists go by a name, and every name each goes by.

The core asks with a name as Tracks show it, and a finder answers with the artists
it knows by that name, best first, each with its other names:

```text
ask      披头士
answer   The Beatles (b10bbbfc-…), UK, Liverpool rock band, score 100;
         also 披头士 (zh), 披頭四 (zh_Hant), Beatles
```

Another site may know more names of an artist than the one that found it: asked
with the artist's MusicBrainz id, a name finder answers with every name it knows the
artist by, the artist's page there, and a photo of the artist, if it has one, which
it writes into a folder the core owns.

```text
ask      b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d
answer   甲壳虫乐队 (zh), 甲壳虫 (zh), ビートルズ (ja), …;
         https://www.wikidata.org/wiki/Q1299; a photo, from
         https://commons.wikimedia.org/wiki/File:…
```

An artist chooser is asked which of the artists offered a name names, given a few of
its songs, and answers with one of them, or none, and why:

```text
ask      GUMI/MAYU, songs: ケビョウニンゲン — ケビョウニンゲン;
         GUMI (Vocaloid/SynthV, JP), MAYU (Belly dancer, JP), Mayu (vocalist)
answer   GUMI, "a Vocaloid voice, and the song is a Vocaloid song"
```

The site refusing the request is a reply, not a failure, so it doesn't count
against the plugin.
"""

from datetime import timedelta
from enum import StrEnum
from typing import Annotated, Final, Protocol

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from medleyplay.plugin_api.enrichers import AiEndpoint
from medleyplay.plugin_api.extension import ExtensionPoint

MAX_NAME: Final = 512
MAX_ARTISTS: Final = 10
"""The most artists a finder answers with."""
MAX_ALIASES: Final = 100
"""The most other names kept of one artist."""
MAX_PAGE: Final = 2048
MAX_CHOICES: Final = 50
"""The most names an artist chooser is asked about at once."""
MAX_SONGS_SHOWN: Final = 8
"""The most of a name's songs an artist chooser is shown."""

type Name = Annotated[str, StringConstraints(min_length=1, max_length=MAX_NAME)]
type Page = Annotated[str, StringConstraints(max_length=MAX_PAGE, pattern=r"^https://")]
"""A page on the web, over HTTPS."""


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


class FindArtistNames(_Model):
    """Ask every name the artist `musicbrainz_id` goes by.

    A photo of the artist goes into `folder`, an empty folder the caller owns; with
    no folder, none is asked for.
    """

    musicbrainz_id: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    folder: Annotated[str, StringConstraints(max_length=4096)] = ""


class FoundArtistNames(_Model):
    """Every name a site knows the artist by; none when it doesn't know the artist.

    `page` is the artist's page on the site. `photo` is the bare name of the photo
    the finder wrote into the folder, and `photo_page` the page that says where the
    photo comes from and who may use it.
    """

    status: FindStatus = FindStatus.OK
    message: Annotated[str, StringConstraints(max_length=500)] = ""
    aliases: Annotated[tuple[ArtistAlias, ...], Field(max_length=MAX_ALIASES)] = ()
    page: Page | None = None
    photo: Annotated[str, StringConstraints(max_length=255)] | None = None
    photo_page: Page | None = None


class ArtistNameFinder(Protocol):
    """Finds every name a site knows an artist by."""

    def find(self, request: FindArtistNames) -> FoundArtistNames:
        """Ask the site which names the artist goes by."""
        ...


class ArtistOption(_Model):
    """An artist a name may name, as it is offered."""

    id: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    name: Name
    disambiguation: Annotated[str, StringConstraints(max_length=MAX_NAME)] = ""
    country: Annotated[str, StringConstraints(max_length=8)] = ""


class NameToChoose(_Model):
    """A name as Tracks show it, a few of its songs, and the artists it may name."""

    name: Name
    songs: Annotated[tuple[Name, ...], Field(max_length=MAX_SONGS_SHOWN)] = ()
    """Some of its songs, each as `title — album`, or its title alone."""
    options: Annotated[tuple[ArtistOption, ...], Field(min_length=1, max_length=MAX_ARTISTS)]


class ChooseArtists(_Model):
    """Ask which of its options each name names, of the AI providers `ai`, in turn."""

    names: Annotated[tuple[NameToChoose, ...], Field(min_length=1, max_length=MAX_CHOICES)]
    ai: tuple[AiEndpoint, ...] = Field(default=(), repr=False)


class ChosenArtist(_Model):
    """The option a name names, or `None` for none of them, and why."""

    name: Name
    artist_id: Annotated[str, StringConstraints(min_length=1, max_length=64)] | None
    why: Annotated[str, StringConstraints(max_length=300)] = ""


class ChosenArtists(_Model):
    """The choice for each name answered for, and the provider that answered."""

    status: FindStatus = FindStatus.OK
    message: Annotated[str, StringConstraints(max_length=500)] = ""
    chosen: Annotated[tuple[ChosenArtist, ...], Field(max_length=MAX_CHOICES)] = ()
    ai_answered: Annotated[str, StringConstraints(max_length=64)] = ""
    """The `id` of the provider that answered."""


class ArtistChooser(Protocol):
    """Chooses which artist each name names, among those offered."""

    def choose(self, request: ChooseArtists) -> ChosenArtists:
        """Answer which option each name names, or none."""
        ...


ARTIST_FINDER = ExtensionPoint[ArtistFinder]("artist_finder")
FIND_ARTIST = ARTIST_FINDER.operation(
    "find",
    FindArtist,
    FoundArtists,
    lambda finder: finder.find,
    deadline=timedelta(minutes=1),
)

ARTIST_NAME_FINDER = ExtensionPoint[ArtistNameFinder]("artist_name_finder")
FIND_ARTIST_NAMES = ARTIST_NAME_FINDER.operation(
    "find",
    FindArtistNames,
    FoundArtistNames,
    lambda finder: finder.find,
    deadline=timedelta(minutes=1),
)

ARTIST_CHOOSER = ExtensionPoint[ArtistChooser]("artist_chooser")
CHOOSE_ARTISTS = ARTIST_CHOOSER.operation(
    "choose",
    ChooseArtists,
    ChosenArtists,
    lambda chooser: chooser.choose,
    deadline=timedelta(minutes=5),
)
