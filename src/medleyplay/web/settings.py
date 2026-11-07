"""The settings API: the household's settings, replaced by an admin at the revision read."""

from fastapi import APIRouter
from pydantic import BaseModel, Field

from medleyplay.domain.settings import ALBUM_MINUTES, RemovalOrder, Settings
from medleyplay.web.deps import SettingsDep, SignedInAccount

router = APIRouter(prefix="/api/settings", tags=["settings"])


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
    revision: int = Field(ge=0)


class SettingsOut(BaseModel):
    """The settings, and their revision."""

    storage_limit: int | None
    removal_order: RemovalOrder
    album_minutes: int | None
    revision: int

    @classmethod
    def of(cls, settings: Settings) -> "SettingsOut":
        """Return the API view of `settings`."""
        return cls(
            storage_limit=settings.storage_limit,
            removal_order=settings.removal_order,
            album_minutes=settings.album_minutes,
            revision=settings.revision,
        )


@router.get("")
def get_settings(_: SignedInAccount, settings: SettingsDep) -> SettingsOut:
    """Return the household's settings."""
    return SettingsOut.of(settings.get())


@router.put("")
def put_settings(body: SettingsIn, me: SignedInAccount, settings: SettingsDep) -> SettingsOut:
    """Replace the settings read at `revision`; a stale revision answers 409. Admins only."""
    saved = settings.put(
        me,
        Settings(
            storage_limit=body.storage_limit,
            removal_order=body.removal_order,
            album_minutes=(
                body.album_minutes
                if "album_minutes" in body.model_fields_set
                else settings.get().album_minutes
            ),
            revision=body.revision,
        ),
    )
    return SettingsOut.of(saved)
