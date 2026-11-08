"""The preferences API: the signed-in Account's own, replaced at the revision read."""

from fastapi import APIRouter
from pydantic import BaseModel, Field

from medleyplay.domain.history import HistoryLength
from medleyplay.domain.preferences import Preferences
from medleyplay.web.deps import PreferencesDep, SignedInAccount

router = APIRouter(prefix="/api/me/preferences", tags=["accounts"])


class PreferencesIn(BaseModel):
    """The preferences to save, and the revision they were read at; 0 if never saved.

    A preference left out keeps what was saved, so a page that knows only some
    of them never resets the others; `null` puts one back to its default.
    """

    shortcuts: dict[str, list[str]] | None = Field(
        default=None, examples=[{"toggle": ["space", "k"], "next": ["shift+right"]}]
    )
    history_length: HistoryLength | None = None
    revision: int = Field(ge=0)


class PreferencesOut(BaseModel):
    """The preferences, and their revision."""

    shortcuts: dict[str, list[str]] | None
    history_length: int | None
    revision: int

    @classmethod
    def of(cls, preferences: Preferences) -> "PreferencesOut":
        """Return the API view of `preferences`."""
        shortcuts = preferences.shortcuts
        return cls(
            shortcuts=None
            if shortcuts is None
            else {command: list(keys) for command, keys in shortcuts.items()},
            history_length=preferences.history_length,
            revision=preferences.revision,
        )


@router.get("")
def get_preferences(me: SignedInAccount, preferences: PreferencesDep) -> PreferencesOut:
    """Return the signed-in Account's preferences."""
    return PreferencesOut.of(preferences.get(me.id))


@router.put("")
def put_preferences(
    body: PreferencesIn, me: SignedInAccount, preferences: PreferencesDep
) -> PreferencesOut:
    """Replace the preferences read at `revision`, keeping those left out; a stale one is 409."""
    saved = preferences.get(me.id)
    given = body.model_fields_set
    shortcuts = body.shortcuts
    changed = Preferences(
        shortcuts=(
            None
            if shortcuts is None
            else {command: tuple(keys) for command, keys in shortcuts.items()}
        )
        if "shortcuts" in given
        else saved.shortcuts,
        history_length=body.history_length if "history_length" in given else saved.history_length,
        revision=body.revision,
    )
    return PreferencesOut.of(preferences.put(me.id, changed))
