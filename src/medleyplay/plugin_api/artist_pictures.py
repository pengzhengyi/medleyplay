"""Picture finders: the pictures a site has of an artist, found by the artist's name.

The core asks with an artist's name, and a picture finder answers with the pictures of
the artists of that name the site knows, the most followed first, each written into a
folder the core owns, with the name the site goes by and how many follow it:

```text
ask      Jay Chou
answer   Jay Chou, 58,855 fans, 6be4a7.jpg;  周杰伦, 743 fans, 2c09d1.jpg
```

Several artists may go by one name, so the household chooses among them. The site
refusing the request is a reply, not a failure, so it doesn't count against the plugin.
"""

from datetime import timedelta
from typing import Annotated, Final, Protocol

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from medleyplay.plugin_api.artists import MAX_NAME, FindStatus, Name
from medleyplay.plugin_api.extension import ExtensionPoint

MAX_PICTURES: Final = 8
"""The most pictures a finder answers with."""


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


PICTURE_FINDER = ExtensionPoint[PictureFinder]("picture_finder")
FIND_PICTURES = PICTURE_FINDER.operation(
    "find",
    FindPictures,
    FoundPictures,
    lambda finder: finder.find,
    deadline=timedelta(minutes=3),
)
