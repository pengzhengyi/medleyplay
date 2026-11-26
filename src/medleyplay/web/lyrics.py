"""The lyrics API: the lyrics a song shows, line by line, and the household's own.

A song's lyrics are looked up on a site through the enricher `lyrics`, as any lookup
is, at `POST /api/enrichers/lyrics/tracks/{id}`. Looked for by hand, by a title and
artist of the household's own, the songs the sites find are listed, each with its
lyrics, for the household to choose from; choosing saves them as its own.
"""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Response, status
from pydantic import BaseModel, Field

from medleyplay.application.lyrics import ShownLyrics
from medleyplay.application.lyrics_match import MatchSongInput, MatchStatus
from medleyplay.application.lyrics_search import LyricsFound, LyricsPick
from medleyplay.domain.catalog import TrackId
from medleyplay.domain.jobs import JobId
from medleyplay.domain.lyrics import MAX_LYRICS, LyricsOrigin
from medleyplay.domain.video_text import MAX_SONGS
from medleyplay.plugin_api import MAX_NAME, LyricsOption
from medleyplay.programs.find_lyrics import MatchSong
from medleyplay.web.deps import LyricsDep, LyricsMatchDep, LyricsSearchDep, SignedInAccount
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
    text: str = Field(description="As their source gave them, LRC or plain, to edit.")
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
            text=shown.text,
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


@router.delete("/{track_id}/lyrics/suggestion")
def dismiss_suggestion(track_id: RowId, _: SignedInAccount, service: LyricsDep) -> LyricsOut | None:
    """Stop showing the lyrics suggested for the song; return what it shows now."""
    return LyricsOut.of(service.dismiss_suggestion(TrackId(track_id)))


class FindLyricsIn(BaseModel):
    """What to look for a song's lyrics by: a title, and an artist or none."""

    title: str = Field(min_length=1, max_length=MAX_NAME)
    artist: str = Field(default="", max_length=MAX_NAME)


class LyricsPickOut(BaseModel):
    """The song an AI model picked of those found, by its place, why, and who answered."""

    option: int
    why: str
    model: str
    host: str
    at: datetime

    @staticmethod
    def of(pick: LyricsPick | None) -> "LyricsPickOut | None":
        """Return the pick as the API shows it, or `None` for none."""
        if pick is None:
            return None
        return LyricsPickOut(
            option=pick.option, why=pick.why, model=pick.model, host=pick.host, at=pick.at
        )


class LyricsFoundOut(BaseModel):
    """What was found when a song's lyrics were last looked for, and what is being asked."""

    title: str = Field(description="The title asked by; empty until asked.")
    artist: str
    options: list[LyricsOption] = Field(description="The songs found, the closest first.")
    found_at: datetime | None
    pick: LyricsPickOut | None = Field(description="An AI model's pick among the songs found.")
    finding: bool
    choosing: bool
    waiting: bool = Field(description="Whether the asking waits for medleyplay to be Online.")
    failure: str | None = Field(
        description="Why the last finding failed; only to the Account that asked, and to admins."
    )
    choice_failure: str | None = Field(description="Why the last asking of an AI model failed.")
    may_choose: bool = Field(
        description="Whether an AI model may be asked to pick: one is set up, and none picked."
    )

    @staticmethod
    def of(found: LyricsFound) -> "LyricsFoundOut":
        """Return what was found as the API shows it."""
        return LyricsFoundOut(
            title=found.title,
            artist=found.artist,
            options=list(found.options),
            found_at=found.found_at,
            pick=LyricsPickOut.of(found.pick),
            finding=found.finding,
            choosing=found.choosing,
            waiting=found.waiting,
            failure=found.failure,
            choice_failure=found.choice_failure,
            may_choose=found.may_choose,
        )


@router.get("/{track_id}/lyrics/found")
def lyrics_found(track_id: RowId, me: SignedInAccount, service: LyricsSearchDep) -> LyricsFoundOut:
    """Return the songs found when the song's lyrics were last looked for."""
    return LyricsFoundOut.of(service.found(me, TrackId(track_id)))


@router.post("/{track_id}/lyrics/find", status_code=status.HTTP_202_ACCEPTED)
def find_lyrics(
    track_id: RowId, body: FindLyricsIn, me: SignedInAccount, service: LyricsSearchDep
) -> None:
    """Look for the songs titled as asked on the lyrics sites, for the song."""
    service.find(me, TrackId(track_id), body.title, body.artist)


@router.post("/{track_id}/lyrics/choose", status_code=status.HTTP_202_ACCEPTED)
def choose_lyrics(track_id: RowId, me: SignedInAccount, service: LyricsSearchDep) -> None:
    """Ask an AI model which of the songs found is the song."""
    service.choose(me, TrackId(track_id))


class MatchSearchIn(BaseModel):
    """The specific search started by Auto-Match."""

    search_job: RowId


class MatchPickIn(MatchSearchIn):
    """The AI pick shown for this search."""

    chosen_at: datetime


@router.post("/{track_id}/lyrics/match/find", status_code=status.HTTP_202_ACCEPTED)
def start_match(
    track_id: RowId, body: MatchSong, me: SignedInAccount, service: LyricsSearchDep
) -> int:
    """Find candidates for an empty saved song and return the Job that found them."""
    return service.start_match(me, TrackId(track_id), body)


@router.post("/{track_id}/lyrics/match/choose", status_code=status.HTTP_202_ACCEPTED)
def choose_match(
    track_id: RowId, body: MatchSearchIn, me: SignedInAccount, service: LyricsSearchDep
) -> None:
    """Ask for a pick only while this is the saved song's current search."""
    service.choose(me, TrackId(track_id), match_job=JobId(body.search_job))


@router.post("/{track_id}/lyrics/match/apply", status_code=status.HTTP_204_NO_CONTENT)
def apply_match(
    track_id: RowId, body: MatchPickIn, _: SignedInAccount, service: LyricsSearchDep
) -> None:
    """Save the site's lyrics only for an unchanged song, search and pick."""
    service.apply_match(TrackId(track_id), JobId(body.search_job), body.chosen_at)


@router.post("/{track_id}/songs/lyrics-match", status_code=status.HTTP_202_ACCEPTED)
def start_background_match(
    track_id: RowId,
    songs: Annotated[list[MatchSongInput], Field(min_length=1, max_length=MAX_SONGS)],
    me: SignedInAccount,
    service: LyricsMatchDep,
) -> tuple[MatchStatus, ...]:
    """Start Auto-Match for the given saved songs of this album."""
    return service.start(me, TrackId(track_id), songs)


@router.get("/{track_id}/songs/lyrics-match")
def background_match_status(
    track_id: RowId, me: SignedInAccount, service: LyricsMatchDep, response: Response
) -> tuple[MatchStatus, ...]:
    """Return the album's manual lyrics selections and Auto-Match outcomes."""
    response.headers["Cache-Control"] = "private, no-store"
    return service.status(me, TrackId(track_id))
