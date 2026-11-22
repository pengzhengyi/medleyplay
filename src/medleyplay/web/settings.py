"""The settings API: the household's settings, replaced by an admin at the revision read."""

from fastapi import APIRouter
from pydantic import BaseModel, Field

from medleyplay.domain.artists import PictureSite
from medleyplay.domain.lyrics import LyricsSite
from medleyplay.domain.settings import (
    ALBUM_MINUTES,
    DEFAULT_AI_NOTES,
    AiAsk,
    AiNote,
    CoverSearch,
    PhotoSearch,
    RemovalOrder,
    Settings,
    SplitAlbums,
)
from medleyplay.web.deps import SettingsDep, SignedInAccount

router = APIRouter(prefix="/api/settings", tags=["settings"])


class AiNoteIn(BaseModel):
    """A note offered beside the AI's button for `ask`, to send with the question."""

    ask: AiAsk
    text: str = Field(examples=["One song per track of the album's standard edition."])

    @classmethod
    def of(cls, note: AiNote) -> "AiNoteIn":
        """Return the API view of `note`."""
        return cls(ask=note.ask, text=note.text)

    def note(self) -> AiNote:
        """Return the note this describes."""
        return AiNote(self.ask, self.text)


class SettingsIn(BaseModel):
    """The settings to save, and the revision they were read at; 0 if never saved."""

    storage_limit: int | None = Field(ge=0, examples=[20 * 1024**3])
    removal_order: RemovalOrder = RemovalOrder.LEAST_FAVORITE
    album_minutes: int | None = Field(
        default=ALBUM_MINUTES,
        description=(
            "A file this many minutes or longer is guessed an album; null guesses none."
            " Left out, it stays as saved."
        ),
    )
    split_albums: SplitAlbums = Field(
        default=SplitAlbums.APPROVAL,
        description=(
            "What becomes of a long file a song list was found for: offered in Clean up"
            " (approval), split when the list can be trusted (auto), or nothing (off)."
            " Left out, it stays as saved."
        ),
    )
    lyrics_sites: tuple[LyricsSite, ...] = Field(
        default=(),
        description=(
            "The sites asked for a song's lyrics, in turn, when LRCLIB has none."
            " Left out, they stay as saved."
        ),
    )
    suggest_lyrics: bool = Field(
        default=True,
        description=(
            "Whether a song no site has lyrics for shows the lyrics of the nearest song one"
            " has, as a suggestion to save or dismiss. Left out, it stays as saved."
        ),
    )
    picture_sites: tuple[PictureSite, ...] = Field(
        default=(),
        description=(
            "The sites that may be asked for pictures of an artist. Left out, they stay as saved."
        ),
    )
    pick_pictures_by_ai: bool = Field(
        default=False,
        description=(
            "Whether an AI model is asked which picture is of an artist as soon as they are"
            " found, rather than when someone asks. Left out, it stays as saved."
        ),
    )
    find_artist_photos: PhotoSearch = Field(
        default=PhotoSearch.UP_NEXT,
        description=(
            "Which artists with no photo the picture sites are asked about without anyone"
            " asking: those of the songs up next (up_next), every one (missing), or none"
            " (off). Left out, it stays as saved."
        ),
    )
    find_album_covers: CoverSearch = Field(
        default=CoverSearch.UP_NEXT,
        description=(
            "Which albums with no cover MusicBrainz is searched for without anyone asking:"
            " those of the songs up next (up_next), every one while MusicBrainz is idle"
            " (missing), or none (off). Left out, it stays as saved."
        ),
    )
    pick_album_covers_by_ai: bool = Field(
        default=False,
        description=(
            "Whether an AI model is asked which cover found fits an album, in the background,"
            " when none plainly does. Left out, it stays as saved."
        ),
    )
    ai_notes: tuple[AiNoteIn, ...] = Field(
        default=tuple(AiNoteIn.of(note) for note in DEFAULT_AI_NOTES),
        description=(
            "The notes offered to whoever asks the AI, beside the button for each ask, each"
            " at most 200 characters. Left out, they stay as saved."
        ),
    )
    revision: int = Field(ge=0)


class SettingsOut(BaseModel):
    """The settings, and their revision."""

    storage_limit: int | None
    removal_order: RemovalOrder
    album_minutes: int | None
    split_albums: SplitAlbums
    lyrics_sites: tuple[LyricsSite, ...]
    suggest_lyrics: bool
    picture_sites: tuple[PictureSite, ...]
    pick_pictures_by_ai: bool
    find_artist_photos: PhotoSearch
    find_album_covers: CoverSearch
    pick_album_covers_by_ai: bool
    ai_notes: tuple[AiNoteIn, ...]
    revision: int

    @classmethod
    def of(cls, settings: Settings) -> "SettingsOut":
        """Return the API view of `settings`."""
        return cls(
            storage_limit=settings.storage_limit,
            removal_order=settings.removal_order,
            album_minutes=settings.album_minutes,
            split_albums=settings.split_albums,
            lyrics_sites=settings.lyrics_sites,
            suggest_lyrics=settings.suggest_lyrics,
            picture_sites=settings.picture_sites,
            pick_pictures_by_ai=settings.pick_pictures_by_ai,
            find_artist_photos=settings.find_artist_photos,
            find_album_covers=settings.find_album_covers,
            pick_album_covers_by_ai=settings.pick_album_covers_by_ai,
            ai_notes=tuple(AiNoteIn.of(note) for note in settings.ai_notes),
            revision=settings.revision,
        )


@router.get("")
def get_settings(_: SignedInAccount, settings: SettingsDep) -> SettingsOut:
    """Return the household's settings."""
    return SettingsOut.of(settings.get())


@router.put("")
def put_settings(body: SettingsIn, me: SignedInAccount, settings: SettingsDep) -> SettingsOut:
    """Replace the settings read at `revision`; a stale revision answers 409. Admins only."""
    saved_before = settings.get()
    saved = settings.put(
        me,
        Settings(
            storage_limit=body.storage_limit,
            removal_order=body.removal_order,
            album_minutes=(
                body.album_minutes
                if "album_minutes" in body.model_fields_set
                else saved_before.album_minutes
            ),
            split_albums=(
                body.split_albums
                if "split_albums" in body.model_fields_set
                else saved_before.split_albums
            ),
            lyrics_sites=(
                body.lyrics_sites
                if "lyrics_sites" in body.model_fields_set
                else saved_before.lyrics_sites
            ),
            picture_sites=(
                body.picture_sites
                if "picture_sites" in body.model_fields_set
                else saved_before.picture_sites
            ),
            suggest_lyrics=(
                body.suggest_lyrics
                if "suggest_lyrics" in body.model_fields_set
                else saved_before.suggest_lyrics
            ),
            pick_pictures_by_ai=(
                body.pick_pictures_by_ai
                if "pick_pictures_by_ai" in body.model_fields_set
                else saved_before.pick_pictures_by_ai
            ),
            find_artist_photos=(
                body.find_artist_photos
                if "find_artist_photos" in body.model_fields_set
                else saved_before.find_artist_photos
            ),
            find_album_covers=(
                body.find_album_covers
                if "find_album_covers" in body.model_fields_set
                else saved_before.find_album_covers
            ),
            pick_album_covers_by_ai=(
                body.pick_album_covers_by_ai
                if "pick_album_covers_by_ai" in body.model_fields_set
                else saved_before.pick_album_covers_by_ai
            ),
            ai_notes=(
                tuple(note.note() for note in body.ai_notes)
                if "ai_notes" in body.model_fields_set
                else saved_before.ai_notes
            ),
            revision=body.revision,
        ),
    )
    return SettingsOut.of(saved)
