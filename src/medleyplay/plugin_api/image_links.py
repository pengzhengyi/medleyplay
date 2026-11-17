"""Image suggesters and fetchers: links to images of an album or artist, and fetching one.

The core asks an image suggester with an album, or an artist, and it answers with a
few links to images of it on the web, each with the page it is shown on and why:

```text
ask      album OK Computer, Radiohead
answer   https://upload.wikimedia.org/…/OK_Computer.png, https://en.wikipedia.org/wiki/OK_Computer,
         "the album's article shows it"
```

Once someone approves a link, an image fetcher is asked to fetch it into a folder the
core owns. Every link is an address over HTTPS on a public site, by name: no address
on the household's own network, by number, or with a login is ever a link.
"""

import re
from datetime import timedelta
from enum import StrEnum
from typing import Annotated, Final, Protocol
from urllib.parse import urlsplit

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints

from medleyplay.plugin_api.artists import MAX_NAME, MAX_SONGS_SHOWN, FindStatus, Name
from medleyplay.plugin_api.enrichers import AiEndpoint
from medleyplay.plugin_api.extension import ExtensionPoint

MAX_IMAGE_LINKS: Final = 6
"""The most links a suggester answers with."""
MAX_LINK: Final = 2048
"""The longest a link is."""
HTTPS_PORT: Final = 443

_TOP_LEVEL: Final = re.compile(r"[a-z]{2,63}|xn--[a-z0-9-]{1,59}")
"""A top-level domain: letters, or an internationalized one. Never digits, so `127.1` isn't."""
_PRIVATE: Final = (".local", ".lan", ".internal", ".home.arpa", ".localhost")
"""The names a household's own network gives its devices."""


def is_public_https(url: str) -> bool:
    """Return whether `url` is an address over HTTPS on a public site, named, with no login.

    It says nothing of where the name leads; whoever fetches checks that too.
    """
    return public_host(url) is not None


def public_host(url: str) -> str | None:
    """Return the host of `url` in ASCII, if it is an address `is_public_https` accepts."""
    if len(url) > MAX_LINK or any(char <= " " or char in "\\\x7f" for char in url):
        return None
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        return None
    host = parts.hostname
    if parts.scheme != "https" or not host or "@" in parts.netloc or port not in {None, HTTPS_PORT}:
        return None
    try:
        named = host.rstrip(".").encode("idna").decode("ascii")
    except UnicodeError:
        return None
    labels = named.split(".")
    if len(labels) < 2 or _TOP_LEVEL.fullmatch(labels[-1]) is None or named.endswith(_PRIVATE):  # noqa: PLR2004 -- a name and its top-level domain
        return None
    return named


def _public_https(url: str) -> str:
    if not is_public_https(url):
        message = "A link is an address over HTTPS on a public site."
        raise ValueError(message)
    return url


type ImageUrl = Annotated[str, AfterValidator(_public_https)]
"""An address over HTTPS on a public site, as `is_public_https` says."""


class _Model(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class ImageSubject(StrEnum):
    """What an image shows: an album's cover, or an artist."""

    ALBUM = "album"
    ARTIST = "artist"


class SuggestImages(_Model):
    """Ask for links to images of `name`, an album or an artist, of the AI providers `ai`.

    For an album, `artist` is its artist, or empty, and `songs` a few of its songs.
    """

    subject: ImageSubject
    name: Name
    artist: Annotated[str, StringConstraints(max_length=MAX_NAME)] = ""
    songs: Annotated[tuple[Name, ...], Field(max_length=MAX_SONGS_SHOWN)] = ()
    ai: tuple[AiEndpoint, ...] = Field(default=(), repr=False)


class ImageLink(_Model):
    """A link to an image, the page it is shown on, if known, and why it is the one."""

    url: ImageUrl
    page: ImageUrl | None = None
    why: Annotated[str, StringConstraints(max_length=300)] = ""


class SuggestedImages(_Model):
    """Links to images of the album or artist, best first, and the provider that answered."""

    status: FindStatus = FindStatus.OK
    message: Annotated[str, StringConstraints(max_length=500)] = ""
    links: Annotated[tuple[ImageLink, ...], Field(max_length=MAX_IMAGE_LINKS)] = ()
    ai_answered: Annotated[str, StringConstraints(max_length=64)] = ""


class ImageSuggester(Protocol):
    """Suggests links to images of an album or an artist."""

    def suggest(self, request: SuggestImages) -> SuggestedImages:
        """Answer with links to images of it, or none."""
        ...


class FetchImage(_Model):
    """Fetch the image at `url` into `folder`, an empty folder the caller owns."""

    url: ImageUrl
    folder: Annotated[str, StringConstraints(max_length=4096)]


class FetchedImage(_Model):
    """The image fetched, written into the folder as `file`, a bare name.

    `file` is empty when there is no image there to fetch, and `message` says why.
    """

    status: FindStatus = FindStatus.OK
    message: Annotated[str, StringConstraints(max_length=500)] = ""
    file: Annotated[str, StringConstraints(max_length=255, pattern=r"^[^/\\]*$")] = ""


class ImageFetcher(Protocol):
    """Fetches an image from a public site."""

    def fetch(self, request: FetchImage) -> FetchedImage:
        """Fetch the image, or say why there is none."""
        ...


IMAGE_SUGGESTER = ExtensionPoint[ImageSuggester]("image_suggester")
SUGGEST_IMAGES = IMAGE_SUGGESTER.operation(
    "suggest",
    SuggestImages,
    SuggestedImages,
    lambda suggester: suggester.suggest,
    deadline=timedelta(minutes=5),
)

IMAGE_FETCHER = ExtensionPoint[ImageFetcher]("image_fetcher")
FETCH_IMAGE = IMAGE_FETCHER.operation(
    "fetch",
    FetchImage,
    FetchedImage,
    lambda fetcher: fetcher.fetch,
    deadline=timedelta(minutes=2),
)
