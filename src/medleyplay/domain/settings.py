"""The household's settings, shared by every Account and changed by an admin."""

from dataclasses import dataclass
from enum import StrEnum
from typing import Final

from medleyplay.domain.artists import PictureSite
from medleyplay.domain.lyrics import LyricsSite

ALBUM_MINUTES: Final = 20
"""How long a file must be, by default, to be guessed an album."""


class PhotoSearch(StrEnum):
    """Which artists with no photo the picture sites are asked about without anyone asking.

    `UP_NEXT` asks about the artists of the song playing and the one after it; `MISSING`
    about every artist linked to MusicBrainz that has none; `OFF` about none, so a site
    is asked only when someone looks for a photo.
    """

    OFF = "off"
    UP_NEXT = "up_next"
    MISSING = "missing"


class CoverSearch(StrEnum):
    """Which albums with no cover MusicBrainz is searched for without anyone asking.

    `UP_NEXT` searches the albums of the song playing and the one after it; `MISSING`
    those, then every album with no cover, one at a time while MusicBrainz is otherwise
    idle; `OFF` none, so an album is searched only when its page opens or someone looks.
    """

    OFF = "off"
    UP_NEXT = "up_next"
    MISSING = "missing"


class SplitAlbums(StrEnum):
    """What becomes of a long file a song list was found for, while it is one file.

    `OFF` offers nothing; `APPROVAL` offers the list in Clean up, to split or keep as
    one file; `AUTO` splits by a list that can be trusted, and offers the rest, and
    asks an AI model in the background for the list of a file with none.
    """

    OFF = "off"
    APPROVAL = "approval"
    AUTO = "auto"


class RemovalOrder(StrEnum):
    """Which Download the policy removes first when it must make room."""

    LEAST_FAVORITE = "least_favorite"


@dataclass(frozen=True)
class Settings:
    """The settings, and the revision they were read at; revision 0 was never saved.

    `storage_limit` is the most bytes Downloads and cache copies may use, or
    `None` for no limit, so nothing is removed. A file no origin names the kind
    of is guessed an album when it is `album_minutes` long or longer; `None`
    guesses none, so it is a song. `split_albums` says what becomes of a long
    file a song list was found for. `picture_sites` are the sites that may be asked for
    pictures of an artist, and `pick_pictures_by_ai` says whether an AI model is asked
    which is of the artist as soon as they are found; `find_artist_photos` says which
    artists with no photo they are asked about without anyone asking. `lyrics_sites` are the sites
    asked for a song's lyrics, in turn, when LRCLIB has none. `find_album_covers` says which
    albums with no cover MusicBrainz is searched for without anyone asking, and
    `pick_album_covers_by_ai` whether an AI model is then asked which cover found fits,
    when none plainly does.
    """

    storage_limit: int | None = None
    removal_order: RemovalOrder = RemovalOrder.LEAST_FAVORITE
    album_minutes: int | None = ALBUM_MINUTES
    split_albums: SplitAlbums = SplitAlbums.APPROVAL
    lyrics_sites: tuple[LyricsSite, ...] = ()
    picture_sites: tuple[PictureSite, ...] = ()
    pick_pictures_by_ai: bool = False
    find_artist_photos: PhotoSearch = PhotoSearch.UP_NEXT
    find_album_covers: CoverSearch = CoverSearch.UP_NEXT
    pick_album_covers_by_ai: bool = False
    revision: int = 0

    @property
    def album_from_ms(self) -> int | None:
        """Return how long a file must be to be guessed an album, in milliseconds."""
        return None if self.album_minutes is None else self.album_minutes * 60_000
