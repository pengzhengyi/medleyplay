"""The JSON a model is asked for, and the limits it is checked against.

```json
{"title": "Night Drive", "artist": "Blue Room", "album": "Re:Start", "year": 2016,
 "songs": [{"start": "00:00", "title": "Intro", "artist": null},
           {"start": "03:12", "title": "Night Drive", "artist": "Blue Room"}]}
```

Every field is optional. The limits are the household's own: text of at most 512
characters, a year from 1000 to 2999, and a song list of at most 300 songs whose
starts rise at least a second a song.
"""

import itertools
import re
from typing import Annotated, Any, Final

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StringConstraints,
    ValidationError,
    field_validator,
)

from medleyplay.plugin_api import SuggestedSong

MAX_TEXT: Final = 512
MAX_SONGS: Final = 300
MIN_YEAR: Final = 1000
MAX_YEAR: Final = 2999
MIN_SONG_MS: Final = 1_000
MAX_START_MS: Final = 7 * 24 * 3600 * 1000
"""A song starting later than a week in is no song of any file."""
_TIME: Final = re.compile(r"(?:(\d{1,3}):)?(\d{1,3}):(\d{2})")
_FENCE: Final = re.compile(r"^```[a-zA-Z]*\s*(.*?)\s*```$", re.DOTALL)

type Text = Annotated[str, StringConstraints(strip_whitespace=True, max_length=MAX_TEXT)]


class BadAnswerError(Exception):
    """What a model said is not the JSON it was asked for; the message names the fields."""


def _milliseconds(value: object) -> object:
    """Read a start written as `3:12`, `1:07:40`, or seconds such as `192` as milliseconds."""
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        timed = _TIME.fullmatch(value.strip())
        if timed is not None:
            hours, minutes, seconds = timed.groups()
            return ((int(hours or 0) * 60 + int(minutes)) * 60 + int(seconds)) * 1000
        try:
            value = float(value)
        except ValueError:
            return value
    if isinstance(value, int | float):
        return round(value * 1000)
    return value


class _Model(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)


class _Song(_Model):
    start: Annotated[int, BeforeValidator(_milliseconds), Field(ge=0, le=MAX_START_MS)]
    title: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_TEXT)
    ]
    artist: Text | None = None


class Answer(_Model):
    """What a model said about a Track, checked."""

    title: Text | None = None
    artist: Text | None = None
    album: Text | None = None
    year: Annotated[int, Field(ge=MIN_YEAR, le=MAX_YEAR)] | None = None
    songs: Annotated[list[_Song], Field(max_length=MAX_SONGS)] | None = None

    @field_validator("songs")
    @classmethod
    def _starts_rise(cls, songs: list[_Song] | None) -> list[_Song] | None:
        for number, (before, after) in enumerate(itertools.pairwise(songs or []), start=2):
            if after.start - before.start < MIN_SONG_MS:
                message = f"Starts rise at least a second a song; song {number} breaks that."
                raise ValueError(message)
        return songs

    def values(self) -> dict[str, str | int]:
        """Return the details the model gave, by field name; blank ones are left out."""
        given: dict[str, str | int | None] = {
            "title": self.title,
            "artist": self.artist,
            "album": self.album,
            "year": self.year,
        }
        return {field: value for field, value in given.items() if value not in {None, ""}}

    def suggested_songs(self) -> tuple[SuggestedSong, ...]:
        """Return the song list, or nothing when the model listed fewer than two songs."""
        songs = self.songs or []
        if len(songs) < 2:  # noqa: PLR2004 -- one song is no list
            return ()
        return tuple(
            SuggestedSong(start_ms=song.start, title=song.title, artist=song.artist or "")
            for song in songs
        )


def parse_answer(text: str) -> Answer:
    """Return what a model's `text` says, or raise `BadAnswerError` naming the failed fields.

    The text is a JSON object, which may sit in a Markdown code fence. The error
    names fields and rules, never the words the model used.
    """
    fenced = _FENCE.match(text.strip())
    try:
        return Answer.model_validate_json(fenced.group(1) if fenced else text)
    except ValidationError as error:
        raise BadAnswerError(_problems(error)) from None


def _problems(error: ValidationError) -> str:
    problems = [_problem(each) for each in error.errors()]
    return "; ".join(dict.fromkeys(problems))


def _problem(each: Any) -> str:  # noqa: ANN401 -- pydantic's own error dict
    where = ".".join(str(part) for part in each["loc"])
    if each["type"] in {"json_invalid", "model_type"}:
        return "The answer is not valid JSON object text."
    return f"{where}: {each['msg']}" if where else str(each["msg"])
