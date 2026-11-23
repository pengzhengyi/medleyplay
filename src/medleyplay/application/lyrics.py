"""A song's lyrics: each source's, and the one shown, the first held in `LyricsOrigin` order.

The household's own come first, then a `.lrc` file beside the audio, then the audio's
tags, then a site that finds lyrics, then, when no site has the song's, the lyrics of
the nearest song one has, suggested until the household saves or dismisses them. The
text is kept as each source gave it and read when shown, so a better reading needs no
lookup again.
"""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import delete, select
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application import Clock
from medleyplay.application.jobs import JobService
from medleyplay.application.lyrics_match_state import supersede_match
from medleyplay.domain.catalog import TrackId
from medleyplay.domain.enrichers import LyricsHeld
from medleyplay.domain.errors import InvalidInputError, NotFoundError
from medleyplay.domain.jobs import JobId
from medleyplay.domain.lyrics import Lyrics, LyricsOrigin, parse_lyrics
from medleyplay.persistence.schema import TrackLyricsRow, TrackRow


@dataclass(frozen=True)
class ShownLyrics:
    """The lyrics a song shows, where they came from, and when; none when it is instrumental.

    `text` is as the source gave it, LRC or plain, from which `lyrics` were read.
    """

    origin: LyricsOrigin
    text: str
    lyrics: Lyrics
    instrumental: bool
    found_at: datetime


def record_lyrics(
    db: Session,
    track_id: TrackId,
    origin: LyricsOrigin,
    text: str,
    now: datetime,
    *,
    instrumental: bool = False,
) -> None:
    """Keep `text` as the song's lyrics from `origin`, or that it is instrumental."""
    row = db.get(TrackLyricsRow, (track_id, origin.value)) or TrackLyricsRow(
        track_id=track_id, origin=origin.value
    )
    row.text, row.instrumental, row.found_at = "" if instrumental else text, instrumental, now
    row.dismissed = False
    db.add(row)
    db.flush()


def forget_lyrics(db: Session, track_id: TrackId, origin: LyricsOrigin) -> None:
    """Drop the song's lyrics from `origin`, so the next source's show."""
    db.execute(
        delete(TrackLyricsRow).where(
            TrackLyricsRow.track_id == track_id, TrackLyricsRow.origin == origin.value
        )
    )


def lyrics_held(db: Session) -> dict[TrackId, LyricsHeld]:
    """Return which lyrics each song holding some has: its own or its files', or found online.

    A suggestion counts as found online, one dismissed as none.
    """
    held: dict[TrackId, LyricsHeld] = {}
    for track_id, origin in db.execute(
        select(TrackLyricsRow.track_id, TrackLyricsRow.origin).where(~TrackLyricsRow.dismissed)
    ):
        local = LyricsOrigin(origin).local
        if local or held.get(TrackId(track_id)) is not LyricsHeld.LOCAL:
            held[TrackId(track_id)] = LyricsHeld.LOCAL if local else LyricsHeld.ONLINE
    return held


def shown_lyrics(db: Session, track_id: TrackId) -> ShownLyrics | None:
    """Return the lyrics the song shows: the first source's in `LyricsOrigin` order, if any."""
    rows = {
        LyricsOrigin(row.origin): row
        for row in db.scalars(
            select(TrackLyricsRow).where(
                TrackLyricsRow.track_id == track_id, ~TrackLyricsRow.dismissed
            )
        )
    }
    for origin in LyricsOrigin:
        row = rows.get(origin)
        if row is not None:
            return ShownLyrics(
                origin, row.text, parse_lyrics(row.text), row.instrumental, row.found_at
            )
    return None


class LyricsService:
    """Read the lyrics a song shows, and keep the household's own."""

    def __init__(
        self,
        units: sessionmaker[Session],
        clock: Clock,
        on_change: Callable[[str], None] | None = None,
        *,
        jobs: JobService | None = None,
    ) -> None:
        """Create a service over the database `units` open, telling `on_change` of each change."""
        self._units = units
        self._clock = clock
        self._on_change = on_change
        self._jobs = jobs

    def lyrics(self, track_id: TrackId) -> ShownLyrics | None:
        """Return the lyrics the song shows, or `None` when no source has any."""
        with self._units() as db:
            _require(db, track_id)
            return shown_lyrics(db, track_id)

    def set_own(self, track_id: TrackId, text: str, *, instrumental: bool = False) -> ShownLyrics:
        """Make `text` the household's lyrics for the song, or say it is instrumental.

        Refused for empty text unless it is instrumental, and for lyrics no song holds.
        """
        if not instrumental and not text.strip():
            message = "Write the lyrics, or say the song is instrumental."
            raise InvalidInputError(message)
        parse_lyrics(text)
        with self._units.begin() as db:
            db.connection().exec_driver_sql("BEGIN IMMEDIATE")
            _require(db, track_id)
            cancelled = supersede_match(db, self._jobs, track_id)
            record_lyrics(
                db, track_id, LyricsOrigin.HOUSEHOLD, text, self._clock(), instrumental=instrumental
            )
            forget_lyrics(db, track_id, LyricsOrigin.SUGGESTED)
            shown = shown_lyrics(db, track_id)
        self._changed(cancelled)
        if shown is None:  # pragma: no cover -- the household's were just kept
            raise NotFoundError(_NO_TRACK)
        return shown

    def forget_own(self, track_id: TrackId) -> ShownLyrics | None:
        """Drop the household's lyrics for the song; return what shows now."""
        with self._units.begin() as db:
            db.connection().exec_driver_sql("BEGIN IMMEDIATE")
            _require(db, track_id)
            cancelled = supersede_match(db, self._jobs, track_id)
            forget_lyrics(db, track_id, LyricsOrigin.HOUSEHOLD)
            shown = shown_lyrics(db, track_id)
        self._changed(cancelled)
        return shown

    def dismiss_suggestion(self, track_id: TrackId) -> ShownLyrics | None:
        """Stop showing the song's suggested lyrics, and return what shows now.

        The same lyrics suggested again stay dismissed; others are shown.
        """
        with self._units.begin() as db:
            db.connection().exec_driver_sql("BEGIN IMMEDIATE")
            _require(db, track_id)
            cancelled = supersede_match(db, self._jobs, track_id)
            row = db.get(TrackLyricsRow, (track_id, LyricsOrigin.SUGGESTED.value))
            if row is not None:
                row.dismissed = True
            shown = shown_lyrics(db, track_id)
        self._changed(cancelled)
        return shown

    def _changed(self, cancelled: JobId | None) -> None:
        if cancelled is not None and self._jobs is not None:
            self._jobs.announce_cancelled(cancelled)
        if self._on_change is not None:
            self._on_change("lyrics")


_NO_TRACK = "There is no such Track."


def _require(db: Session, track_id: TrackId) -> None:
    if db.get(TrackRow, track_id) is None:
        raise NotFoundError(_NO_TRACK)
