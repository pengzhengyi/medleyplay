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


class AiAsk(StrEnum):
    """What someone asks the AI from: a Track's details, or the songs of its file."""

    DETAILS = "details"
    SONGS = "songs"


@dataclass(frozen=True)
class AiNote:
    """A note offered to whoever asks the AI, beside the button for `ask`, to send with it."""

    ask: AiAsk
    text: str


MAX_AI_NOTE: Final = 200
"""The most characters a note offered to the AI may have; several are sent as one."""
MAX_AI_NOTES: Final = 30
DEFAULT_AI_NOTES: Final = (
    AiNote(AiAsk.DETAILS, "Name the album the song first came out on."),
    AiNote(AiAsk.DETAILS, "Keep names in their own language; don't translate them."),
    AiNote(AiAsk.SONGS, "One song per track of the album's standard edition."),
    AiNote(AiAsk.SONGS, "A live album: leave out the talking between songs."),
    AiNote(AiAsk.SONGS, "A deluxe edition: the bonus tracks come after the album's own."),
)
"""The notes a household starts with, until an admin edits them."""


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
    asked for a song's lyrics, in turn, when LRCLIB has none, and `suggest_lyrics` says whether
    a song none of them has is shown the lyrics of the nearest song they have, as a
    suggestion. `find_album_covers` says which
    albums with no cover MusicBrainz is searched for without anyone asking, and
    `pick_album_covers_by_ai` whether an AI model is then asked which cover found fits,
    when none plainly does. `ai_notes` are offered to whoever asks the AI, to tell it
    more than the default question does.
    """

    storage_limit: int | None = None
    removal_order: RemovalOrder = RemovalOrder.LEAST_FAVORITE
    album_minutes: int | None = ALBUM_MINUTES
    split_albums: SplitAlbums = SplitAlbums.APPROVAL
    lyrics_sites: tuple[LyricsSite, ...] = ()
    suggest_lyrics: bool = True
    picture_sites: tuple[PictureSite, ...] = ()
    pick_pictures_by_ai: bool = False
    find_artist_photos: PhotoSearch = PhotoSearch.UP_NEXT
    find_album_covers: CoverSearch = CoverSearch.UP_NEXT
    pick_album_covers_by_ai: bool = False
    ai_notes: tuple[AiNote, ...] = DEFAULT_AI_NOTES
    revision: int = 0

    @property
    def album_from_ms(self) -> int | None:
        """Return how long a file must be to be guessed an album, in milliseconds."""
        return None if self.album_minutes is None else self.album_minutes * 60_000
