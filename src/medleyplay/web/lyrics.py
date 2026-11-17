"""The lyrics API: the lyrics a song shows, line by line, and the household's own.

A song's lyrics are looked up on a site through the enricher `lyrics`, as any lookup
is, at `POST /api/enrichers/lyrics/tracks/{id}`.
"""

from datetime import datetime

from fastapi import APIRouter
from pydantic import BaseModel, Field

from medleyplay.application.lyrics import ShownLyrics
from medleyplay.domain.catalog import TrackId
from medleyplay.domain.lyrics import MAX_LYRICS, LyricsOrigin
from medleyplay.web.deps import LyricsDep, SignedInAccount
from medleyplay.web.ids import RowId

router = APIRouter(prefix="/api/tracks", tags=["lyrics"])


class WordOut(BaseModel):
    """A word of a line, and when it is sung, in milliseconds."""

    at_ms: int
    text: str


class LineOut(BaseModel):
    """A line, when it is sung, its translation or empty, and its words when timed one by one."""

    at_ms: int
    text: str
    translation: str
    words: list[WordOut]


class LyricsOut(BaseModel):
    """The lyrics a song shows: timed `lines`, or `plain` text; none for an instrumental."""

    origin: LyricsOrigin = Field(description="Where they came from: the first held of each.")
    synced: bool
    instrumental: bool
    lines: list[LineOut]
    plain: str
    found_at: datetime

    @staticmethod
    def of(shown: ShownLyrics | None) -> "LyricsOut | None":
        """Return the lyrics as the API shows them, or `None` for none."""
        if shown is None:
            return None
        lyrics = shown.lyrics
        return LyricsOut(
            origin=shown.origin,
            synced=lyrics.synced,
            instrumental=shown.instrumental,
            lines=[
                LineOut(
                    at_ms=line.at_ms,
                    text=line.text,
                    translation=line.translation,
                    words=[WordOut(at_ms=word.at_ms, text=word.text) for word in line.words],
                )
                for line in lyrics.lines
            ],
            plain=lyrics.plain,
            found_at=shown.found_at,
        )


class LyricsIn(BaseModel):
    """The household's lyrics for a song, LRC or plain text, or that it is instrumental."""

    text: str = Field(default="", max_length=MAX_LYRICS)
    instrumental: bool = False


@router.get("/{track_id}/lyrics")
def lyrics(track_id: RowId, _: SignedInAccount, service: LyricsDep) -> LyricsOut | None:
    """Return the lyrics the song shows, or `null` when no source has any."""
    return LyricsOut.of(service.lyrics(TrackId(track_id)))


@router.put("/{track_id}/lyrics")
def set_lyrics(
    track_id: RowId, body: LyricsIn, _: SignedInAccount, service: LyricsDep
) -> LyricsOut | None:
    """Make the household's lyrics the song's, shown before any other source's."""
    return LyricsOut.of(
        service.set_own(TrackId(track_id), body.text, instrumental=body.instrumental)
    )


@router.delete("/{track_id}/lyrics")
def forget_lyrics(track_id: RowId, _: SignedInAccount, service: LyricsDep) -> LyricsOut | None:
    """Drop the household's lyrics; return what the song shows now."""
    return LyricsOut.of(service.forget_own(TrackId(track_id)))
