"""Web picture discovery: each image has a source page; nothing is downloaded."""

from typing import Annotated, Final, Protocol

from pydantic import BaseModel, ConfigDict, Field, SecretStr, StringConstraints

from medleyplay.plugin_api.artists import MAX_NAME, FindStatus
from medleyplay.plugin_api.extension import ExtensionPoint
from medleyplay.plugin_api.image_links import MAX_IMAGE_LINKS, ImageUrl

TAVILY: Final = "tavily"
type PictureName = Annotated[str, StringConstraints(max_length=MAX_NAME)]


class _Model(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class SearchPictures(_Model):
    """Search for an album cover, or an artist photo when `album` is empty."""

    album: PictureName
    artist: PictureName
    key: SecretStr = Field(repr=False)


class PictureCandidate(_Model):
    """An image, its source page, and the page's title."""

    url: ImageUrl
    page: ImageUrl
    title: PictureName


class PictureResults(_Model):
    """The source-linked candidates the site returned, or its refusal."""

    status: FindStatus = FindStatus.OK
    images: Annotated[tuple[PictureCandidate, ...], Field(max_length=MAX_IMAGE_LINKS)] = ()


class PictureSearcher(Protocol):
    """Finds source-linked picture candidates."""

    def search(self, request: SearchPictures) -> PictureResults:
        """Return images on pages found for the request."""
        ...


IMAGE_SEARCHER = ExtensionPoint[PictureSearcher]("image_searcher")
SEARCH_PICTURES = IMAGE_SEARCHER.operation(
    "search", SearchPictures, PictureResults, lambda provider: provider.search
)
