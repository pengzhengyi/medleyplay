"""Picture finders: the pictures a site has of an artist, found by the artist's name.

The core asks with an artist's name, and a picture finder answers with the pictures of
the artists of that name the site knows, the most followed first, each written into a
folder the core owns, with the name the site goes by and how many follow it:

```text
ask      Jay Chou
answer   Jay Chou, 58,855 fans, 6be4a7.jpg;  周杰伦, 743 fans, 2c09d1.jpg
```

Several artists may go by one name, so the household chooses among them, or asks a
picture chooser which is the artist: it is shown the artist, a few of its songs, the
household's own words about it if any, and the name and fans of each picture's artist.
The site refusing the request is a reply, not a failure, so it doesn't count against
the plugin.
"""

from datetime import timedelta
from typing import Annotated, Final, Protocol

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from medleyplay.plugin_api.artists import MAX_NAME, MAX_SONGS_SHOWN, FindStatus, Name
from medleyplay.plugin_api.enrichers import MAX_HINT, AiEndpoint
from medleyplay.plugin_api.extension import ExtensionPoint

MAX_PICTURES: Final = 8
"""The most pictures a finder answers with."""
MAX_OTHER_NAMES: Final = 8
"""The most other names of an artist a picture chooser is shown."""


class _Model(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class FindPictures(_Model):
    """Ask for pictures of the artists going by `artist`, each written into `folder`."""

    artist: Name
    folder: Annotated[str, StringConstraints(max_length=4096)] = ""


class FoundPicture(_Model):
    """A picture of an artist the site knows by `name`, written into the folder as `file`.

    `fans` is how many follow the artist on the site, when it says.
    """

    name: Annotated[str, StringConstraints(max_length=MAX_NAME)]
    fans: Annotated[int, Field(ge=0)] | None = None
    file: Annotated[str, StringConstraints(min_length=1, max_length=255, pattern=r"^[^/\\]+$")]


class FoundPictures(_Model):
    """The pictures found, the most followed artist first; none when the site has none."""

    status: FindStatus = FindStatus.OK
    message: Annotated[str, StringConstraints(max_length=500)] = ""
    pictures: Annotated[tuple[FoundPicture, ...], Field(max_length=MAX_PICTURES)] = ()


class PictureFinder(Protocol):
    """Finds the pictures a site has of the artists going by a name."""

    def find(self, request: FindPictures) -> FoundPictures:
        """Ask the site for pictures of the artists going by the name."""
        ...


class PictureOption(_Model):
    """A picture offered: the name the site knows its artist by, and how many follow it."""

    name: Annotated[str, StringConstraints(max_length=MAX_NAME)]
    fans: Annotated[int, Field(ge=0)] | None = None


class ChoosePicture(_Model):
    """Ask which of `options` is a picture of `artist`, of the AI providers `ai`, in turn.

    `about` says what tells the artist apart, and where it is from; `hint` is what the
    household says of which artist it means, empty for nothing.
    """

    artist: Name
    other_names: Annotated[tuple[Name, ...], Field(max_length=MAX_OTHER_NAMES)] = ()
    about: Annotated[str, StringConstraints(max_length=MAX_NAME)] = ""
    songs: Annotated[tuple[Name, ...], Field(max_length=MAX_SONGS_SHOWN)] = ()
    hint: Annotated[str, StringConstraints(max_length=MAX_HINT)] = ""
    options: Annotated[tuple[PictureOption, ...], Field(min_length=1, max_length=MAX_PICTURES)]
    ai: tuple[AiEndpoint, ...] = Field(default=(), repr=False)


class ChosenPicture(_Model):
    """The option, by its place in those offered, that is the artist, or `None`, and why."""

    status: FindStatus = FindStatus.OK
    message: Annotated[str, StringConstraints(max_length=500)] = ""
    option: Annotated[int, Field(ge=0, lt=MAX_PICTURES)] | None = None
    why: Annotated[str, StringConstraints(max_length=300)] = ""
    ai_answered: Annotated[str, StringConstraints(max_length=64)] = ""
    """The `id` of the provider that answered."""


class PictureChooser(Protocol):
    """Chooses which picture of those offered is of the artist."""

    def choose(self, request: ChoosePicture) -> ChosenPicture:
        """Answer which option is the artist, or none."""
        ...


PICTURE_FINDER = ExtensionPoint[PictureFinder]("picture_finder")
FIND_PICTURES = PICTURE_FINDER.operation(
    "find",
    FindPictures,
    FoundPictures,
    lambda finder: finder.find,
    deadline=timedelta(minutes=3),
)

PICTURE_CHOOSER = ExtensionPoint[PictureChooser]("picture_chooser")
CHOOSE_PICTURE = PICTURE_CHOOSER.operation(
    "choose",
    ChoosePicture,
    ChosenPicture,
    lambda chooser: chooser.choose,
    deadline=timedelta(minutes=5),
)
