"""Split offers: the long files a song list was found for, to split, or keep as one file.

Each long file shown as an album that isn't split yet, and that the household hasn't
chosen to keep as one, is offered with the list its video's text or an AI model gave,
as the household's setting *Split albums* says:

| Setting | What becomes of a file with a list | Asking an AI model for a list |
| --- | --- | --- |
| Off | nothing | only when someone asks |
| Approval | offered, to split or keep | only when someone asks |
| Auto | split when the list is trusted, offered otherwise | asked for no one, a few at a time |

Splitting saves the list as the songs editor saves rows, so a file split since the list
was shown is refused and left as it is. A file kept as one, by *Keep* or by unsplitting
it, is offered nothing again.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

from sqlalchemy import exists, or_, select
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application import Clock
from medleyplay.application.details import suggested_songs_of, video_text_of
from medleyplay.application.enrichment import EnrichmentService
from medleyplay.application.segments import SongsService, keep_as_one
from medleyplay.application.settings import read_settings
from medleyplay.domain.accounts import Account
from medleyplay.domain.catalog import TrackId
from medleyplay.domain.details import Kind
from medleyplay.domain.errors import ConflictError, InvalidInputError
from medleyplay.domain.segments import SongRow
from medleyplay.domain.settings import SplitAlbums
from medleyplay.domain.split_offers import SplitOffer, offer_of
from medleyplay.domain.video_text import read_video
from medleyplay.persistence.schema import (
    SegmentRow,
    SourceRow,
    SplitOfferStateRow,
    TrackRow,
    VideoTextRow,
)

AI_AT_ONCE: Final = 3
"""The most Jobs of the AI's that asking for no one keeps running or waiting at once."""


@dataclass(frozen=True)
class OfferedFile:
    """A long file shown as an album, not split yet, and the list offered for it, if any.

    `has_text` says its video's text was read, so an AI model may be asked for a list.
    """

    track_id: TrackId
    title: str
    artist: str
    length_ms: int | None
    offer: SplitOffer | None
    has_text: bool


@dataclass(frozen=True)
class SplitOffers:
    """The household's setting, and the long files offered under it, most recently added first."""

    setting: SplitAlbums
    files: tuple[OfferedFile, ...]


@dataclass(frozen=True)
class Chosen:
    """A file to split, and the offer the household saw for it, by its signature."""

    track_id: TrackId
    signature: str


@dataclass(frozen=True)
class SplitDone:
    """How many files were split, and how many were left as they were."""

    split: int
    left: int


class SplitOfferService:
    """Offer long files to split by the song list found, split them, or keep them as one."""

    def __init__(
        self,
        units: sessionmaker[Session],
        clock: Clock,
        songs: SongsService,
        enrichment: EnrichmentService,
    ) -> None:
        """Create the service, splitting through `songs` and asking the AI through `enrichment`."""
        self._units = units
        self._clock = clock
        self._songs = songs
        self._enrichment = enrichment

    def offers(self) -> SplitOffers:
        """Return the setting, and every long file to split or to keep, unless it is Off."""
        with self._units() as db:
            setting = read_settings(db).split_albums
            files = () if setting is SplitAlbums.OFF else tuple(_offered(db))
        return SplitOffers(setting, files)

    def split(self, caller: Account, chosen: Sequence[Chosen]) -> SplitDone:
        """Split each file by the offer the household saw for it.

        A file whose offer is another now, or none, or that was split meanwhile, is left
        as it is, as is one whose list can't be saved.
        """
        del caller
        with self._units() as db:
            offered = {each.track_id: each.offer for each in _offered(db)}
        done = 0
        for each in chosen:
            offer = offered.get(each.track_id)
            if (
                offer is not None
                and offer.signature == each.signature
                and self._save(each.track_id, offer)
            ):
                done += 1
        if done:
            self._songs.announce()
        return SplitDone(done, len(chosen) - done)

    def keep(self, caller: Account, track_ids: Sequence[TrackId]) -> int:
        """Keep each file as one, so no list is offered for it again; return how many."""
        del caller
        now = self._clock()
        with self._units.begin() as db:
            kept = [track_id for track_id in dict.fromkeys(track_ids) if db.get(TrackRow, track_id)]
            for track_id in kept:
                keep_as_one(db, track_id, now)
        return len(kept)

    def auto_split(self) -> int:
        """Under Auto, split each file whose list is trusted, and ask the AI about those with none.

        A trusted list that fails to save is not tried again until it changes. Return how
        many files were split.
        """
        with self._units() as db:
            if read_settings(db).split_albums is not SplitAlbums.AUTO:
                return 0
            files = list(_offered(db))
            failed = {
                TrackId(row.track_id): row.failed
                for row in db.scalars(
                    select(SplitOfferStateRow).where(SplitOfferStateRow.failed.is_not(None))
                )
            }
        done = 0
        for each in files:
            offer = each.offer
            if offer is None or not offer.trusted or failed.get(each.track_id) == offer.signature:
                continue
            if self._save(each.track_id, offer):
                done += 1
            else:
                self._note_failed(each.track_id, offer.signature)
        if done:
            self._songs.announce()
        unlisted = [each.track_id for each in files if each.offer is None and each.has_text]
        self._enrichment.ask_ai_about(unlisted, at_most=AI_AT_ONCE)
        return done

    def _save(self, track_id: TrackId, offer: SplitOffer) -> bool:
        rows = [SongRow(id=None, song=song) for song in offer.songs]
        try:
            self._songs.save(track_id, rows, known=(), announce=False)
        except (ConflictError, InvalidInputError):
            return False
        return True

    def _note_failed(self, track_id: TrackId, signature: str) -> None:
        with self._units.begin() as db:
            state = db.get(SplitOfferStateRow, track_id) or SplitOfferStateRow(track_id=track_id)
            state.failed = signature
            db.add(state)


@dataclass(frozen=True)
class LibrarySweep:
    """A sweep of the Library: the enrichers set to find all, then what Auto splits."""

    enrichment: EnrichmentService
    offers: SplitOfferService

    def sweep(self) -> int:
        """Queue the enrichers set to find all, then split what Auto splits; say how many queued."""
        queued = self.enrichment.sweep()
        self.offers.auto_split()
        return queued


def _offered(db: Session) -> list[OfferedFile]:
    """Return every long file shown as an album, not split, and not kept as one."""
    album_from_ms = read_settings(db).album_from_ms
    is_album = (
        TrackRow.kind == Kind.ALBUM
        if album_from_ms is None
        else or_(
            TrackRow.kind == Kind.ALBUM,
            (TrackRow.kind.is_(None)) & (TrackRow.duration_ms >= album_from_ms),
        )
    )
    a_song = exists().where(SegmentRow.track_id == TrackRow.id)
    split = exists().where(
        SegmentRow.album_source_id == SourceRow.id, SourceRow.track_id == TrackRow.id
    )
    kept = exists().where(
        SplitOfferStateRow.track_id == TrackRow.id, SplitOfferStateRow.kept_at.is_not(None)
    )
    with_text = select(VideoTextRow.track_id)
    rows = db.execute(
        select(TrackRow, TrackRow.id.in_(with_text))
        .where(is_album, ~a_song, ~split, ~kept)
        .order_by(TrackRow.added_at.desc(), TrackRow.id.desc())
    ).all()
    files: list[OfferedFile] = []
    for track, has_text in rows:
        track_id = TrackId(track.id)
        text = video_text_of(db, track_id) if has_text else None
        video = read_video(text).songs if text is not None else ()
        files.append(
            OfferedFile(
                track_id=track_id,
                title=track.title,
                artist=track.artist,
                length_ms=track.duration_ms,
                offer=offer_of(video, suggested_songs_of(db, track_id), track.duration_ms),
                has_text=bool(has_text),
            )
        )
    return files
