"""The songs API: splitting an album file into songs, editing them by id, and unsplitting."""

from typing import Annotated

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr

from medleyplay.application.segments import SongsView
from medleyplay.domain.catalog import TrackId
from medleyplay.domain.jobs import JobId
from medleyplay.domain.segments import SegmentId, SongRow
from medleyplay.domain.silences import Silences, SilenceState
from medleyplay.domain.video_text import MAX_SONGS, Song
from medleyplay.web.deps import EventsDep, SignedInAccount, SilencesDep, SongsDep
from medleyplay.web.details import AnsweredByOut
from medleyplay.web.ids import RowId

router = APIRouter(prefix="/api/tracks", tags=["songs"])

# A song's id, strict, so `"1"` or `true` is refused rather than read as 1.
type SongId = Annotated[StrictInt, Field(ge=1, le=2**63 - 1)]


class SongIn(BaseModel):
    """A row of the songs editor: the song it keeps by id, or `null` for a new one."""

    model_config = ConfigDict(extra="forbid")

    id: SongId | None = None
    start_ms: Annotated[StrictInt, Field(ge=0, le=2**63 - 1)]
    title: StrictStr
    artist: StrictStr = ""


class RowsIn(BaseModel):
    """The file's songs, in order; a song left out is removed with its Track.

    `known` names the songs the editor saw, so a save after someone else's is
    refused rather than removing a song nobody saw.
    """

    model_config = ConfigDict(extra="forbid")

    known: Annotated[list[SongId], Field(max_length=MAX_SONGS)] | None = None
    lyric_picks: Annotated[list[SongId], Field(max_length=MAX_SONGS)] = Field(default_factory=list)

    rows: Annotated[list[SongIn], Field(max_length=MAX_SONGS)] = Field(
        examples=[
            [
                {"id": None, "start_ms": 0, "title": "Intro"},
                {"id": 7, "start_ms": 192_000, "title": "Night Drive", "artist": "Blue Room"},
            ]
        ]
    )


class ListedSongOut(BaseModel):
    """A song of a list found: where it starts, its title, and its artist, or ""."""

    start_ms: int
    title: str
    artist: str


class SongOut(ListedSongOut):
    """A song of a split file: its id, its Track, and where it ends, if known."""

    id: int
    track_id: int
    end_ms: int | None


class SongsOut(BaseModel):
    """A file's songs, whether its length changed since it was split, and the lists found."""

    track_id: int
    length_ms: int | None
    needs_check: bool
    songs: list[SongOut]
    found: list[list[ListedSongOut]]
    suggested: list[ListedSongOut]
    """The song list an AI model suggested for the file, or empty."""
    suggested_by: AnsweredByOut | None
    """The AI model that last answered for the file, as it was then; none if none has."""

    @classmethod
    def of(cls, view: SongsView) -> "SongsOut":
        """Return the API view of `view`."""
        return cls(
            track_id=view.track_id,
            length_ms=view.length_ms,
            needs_check=view.needs_check,
            songs=[
                SongOut(
                    id=song.id,
                    track_id=song.track_id,
                    start_ms=song.start_ms,
                    end_ms=song.end_ms,
                    title=song.title,
                    artist=song.artist,
                )
                for song in view.songs
            ],
            found=[[_listed(song) for song in listed] for listed in view.found],
            suggested=[_listed(song) for song in view.suggested],
            suggested_by=AnsweredByOut.of(view.suggested_by),
        )


class ListIn(BaseModel):
    """A pasted song list: one song a line, its time first or last."""

    model_config = ConfigDict(extra="forbid")

    text: Annotated[StrictStr, Field(max_length=100_000)] = Field(
        examples=["00:00 Intro\n1. 03:12 Night Drive - Blue Room\nBlue Room 1:07:40"]
    )


class ListOut(BaseModel):
    """The songs a pasted list names."""

    songs: list[ListedSongOut]


class ProblemOut(BaseModel):
    """Why a line of a list is no song; with `line` `null`, why the list isn't one."""

    line: int | None
    message: str


class ListCheckOut(BaseModel):
    """The songs a list names as it is typed, and every problem with it, by line."""

    songs: list[ListedSongOut]
    problems: list[ProblemOut]


class RemovedOut(BaseModel):
    """How many songs were removed."""

    removed: int


def _listed(song: Song) -> ListedSongOut:
    return ListedSongOut(start_ms=song.start_ms, title=song.title, artist=song.artist)


@router.get("/{track_id}/songs")
def songs(track_id: RowId, _: SignedInAccount, service: SongsDep) -> SongsOut:
    """Return the file's songs, none when it isn't split, and the song lists found for it."""
    return SongsOut.of(service.songs(TrackId(track_id)))


@router.put("/{track_id}/songs")
def save_songs(
    track_id: RowId, body: RowsIn, _: SignedInAccount, service: SongsDep, events: EventsDep
) -> SongsOut:
    """Save the file's song list together with the named pending lyrics picks."""
    rows = [
        SongRow(
            None if row.id is None else SegmentId(row.id),
            Song(row.start_ms, row.title, row.artist),
        )
        for row in body.rows
    ]
    known = None if body.known is None else [SegmentId(song) for song in body.known]
    saved = service.save(
        TrackId(track_id), rows, known, lyric_picks=tuple(map(JobId, body.lyric_picks))
    )
    events.publish_tracks()
    if saved.lyrics_saved:
        events.publish_lyrics_saved(saved.lyrics_saved)
    return SongsOut.of(saved)


@router.post("/{track_id}/songs/read")
def read_list(track_id: RowId, body: ListIn, _: SignedInAccount, service: SongsDep) -> ListOut:
    """Read a song list pasted for the file; 422 names the first line that isn't a song."""
    return ListOut(
        songs=[_listed(song) for song in service.read_list(TrackId(track_id), body.text)]
    )


@router.post("/{track_id}/songs/check")
def check_list(
    track_id: RowId, body: ListIn, _: SignedInAccount, service: SongsDep
) -> ListCheckOut:
    """Check a song list as it is typed: its songs, and each line that isn't one, and why."""
    checked = service.check_list(TrackId(track_id), body.text)
    return ListCheckOut(
        songs=[_listed(song) for song in checked.songs],
        problems=[
            ProblemOut(line=problem.line, message=problem.message) for problem in checked.problems
        ],
    )


class UnsplitIn(BaseModel):
    """The songs reviewed before undoing a split."""

    model_config = ConfigDict(extra="forbid")
    known: Annotated[list[SongId], Field(max_length=MAX_SONGS)]


@router.delete("/{track_id}/songs")
def unsplit(
    track_id: RowId,
    _: SignedInAccount,
    service: SongsDep,
    events: EventsDep,
    body: UnsplitIn | None = None,
) -> RemovedOut:
    """Remove every song of the file, with its Track."""
    known = None if body is None else [SegmentId(song) for song in body.known]
    removed = service.unsplit(TrackId(track_id), known)
    if removed:
        events.publish_tracks()
    return RemovedOut(removed=removed)


class SilenceOut(BaseModel):
    """A quiet stretch of a file's audio, from `start_ms` to `end_ms`."""

    start_ms: int
    end_ms: int


class SilencesOut(BaseModel):
    """What is known of the gaps in a file's audio, and the gaps, in order, once found."""

    state: SilenceState
    silences: list[SilenceOut]

    @classmethod
    def of(cls, known: Silences) -> "SilencesOut":
        """Return the API view of `known`."""
        return cls(
            state=known.state,
            silences=[SilenceOut(start_ms=s.start_ms, end_ms=s.end_ms) for s in known.silences],
        )


@router.get("/{track_id}/silences")
def silences(track_id: RowId, _: SignedInAccount, service: SilencesDep) -> SilencesOut:
    """Say what is known of the gaps in the file's audio."""
    return SilencesOut.of(service.silences(TrackId(track_id)))


@router.post("/{track_id}/silences/find")
def find_silences(track_id: RowId, me: SignedInAccount, service: SilencesDep) -> SilencesOut:
    """Find the gaps in the file's audio, unless they are known or being found."""
    return SilencesOut.of(service.find(me, TrackId(track_id)))
