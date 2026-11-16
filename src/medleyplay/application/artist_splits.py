"""Artist names written as several artists: offered to split, then split or kept as written.

A name the Library's songs show as their artist or album artist, such as *GUMI/MAYU*
or *スズム feat. GUMI*, is offered with the artists it lists, until the household
splits it, so each song counts under each artist, or keeps it as written. Either is
remembered for the name, and binds every song showing it, now and later, until it is
forgotten. A name linked to one MusicBrainz artist is offered saying so, as it may name
a collaboration by one of its artists; a name to tidy first isn't offered.
"""

from collections import Counter
from collections.abc import Callable, Iterable
from dataclasses import dataclass

from sqlalchemy import delete, select
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application import Clock
from medleyplay.application.track_artists import rebind_written
from medleyplay.domain.artist_split import Credit, split_suggestion
from medleyplay.domain.artists import artist_key
from medleyplay.domain.errors import InvalidInputError
from medleyplay.domain.tidy import tidy_artist
from medleyplay.persistence.schema import ArtistLinkRow, NameSplitRow, TrackRow


@dataclass(frozen=True)
class SplitOffer:
    """A name written as several artists, written as most of its songs write it."""

    written: str
    credits: tuple[Credit, ...]
    songs: int
    """How many songs show it, as their artist or album artist."""
    linked: bool = False
    """Whether the name is linked to one MusicBrainz artist, so may name one artist."""


@dataclass(frozen=True)
class SplitDecision:
    """A name the household split or kept as written."""

    written: str
    split: bool


class ArtistSplitService:
    """Offer the names written as several artists, and split them or keep them as written."""

    def __init__(
        self,
        units: sessionmaker[Session],
        clock: Clock,
        on_change: Callable[[str], None] | None = None,
    ) -> None:
        """Create a service over the database `units` open, telling `on_change` of each change."""
        self._units = units
        self._clock = clock
        self._on_change = on_change

    def offers(self) -> tuple[SplitOffer, ...]:
        """Return every name to split that the household hasn't decided, most songs first."""
        with self._units() as db:
            shown = db.execute(select(TrackRow.id, TrackRow.artist, TrackRow.album_artist)).all()
            decided = set(db.scalars(select(NameSplitRow.key)))
            linked = set(
                db.scalars(select(ArtistLinkRow.key).where(ArtistLinkRow.artist_id.is_not(None)))
            )
        written: dict[str, Counter[str]] = {}
        songs: dict[str, set[int]] = {}
        for track_id, artist, album_artist in shown:
            for name in {artist.strip(), album_artist.strip()} - {""}:
                key = artist_key(name)
                if key not in decided:
                    written.setdefault(key, Counter())[name] += 1
                    songs.setdefault(key, set()).add(track_id)
        offers = []
        for key, forms in written.items():
            name = forms.most_common(1)[0][0]
            listed = split_suggestion(name)
            if listed is not None and tidy_artist(name) is None:
                offers.append(SplitOffer(name, listed, len(songs[key]), linked=key in linked))
        offers.sort(key=lambda offer: (-offer.songs, artist_key(offer.written)))
        return tuple(offers)

    def decided(self) -> tuple[SplitDecision, ...]:
        """Return every name split or kept as written, by name."""
        with self._units() as db:
            rows = db.scalars(select(NameSplitRow)).all()
            decisions = [SplitDecision(row.written, split=row.split) for row in rows]
        return tuple(sorted(decisions, key=lambda each: artist_key(each.written)))

    def forget(self, names: Iterable[str]) -> None:
        """Forget what was decided for each name, so it is bound as written and offered again."""
        keys = {artist_key(name) for name in names}
        with self._units.begin() as db:
            db.execute(delete(NameSplitRow).where(NameSplitRow.key.in_(keys)))
            rebind_written(db, keys)
        self._changed()

    def split(self, names: Iterable[str]) -> None:
        """Split each name into the artists it lists, binding every song showing it to each."""
        self._decide(names, split=True)

    def keep(self, names: Iterable[str]) -> None:
        """Keep each name as written, as one artist, so it isn't offered again."""
        self._decide(names, split=False)

    def _decide(self, names: Iterable[str], *, split: bool) -> None:
        with self._units.begin() as db:
            keys: set[str] = set()
            for name in dict.fromkeys(name.strip() for name in names):
                listed = split_suggestion(name)
                if split and listed is None:
                    message = f"“{name}” names one artist, so it isn't split."
                    raise InvalidInputError(message)
                key = artist_key(name)
                row = db.get(NameSplitRow, key) or NameSplitRow(key=key)
                row.written, row.split, row.decided_at = name, split, self._clock()
                row.parts = [
                    {"written": credit.written, "role": str(credit.role)} for credit in listed or ()
                ]
                db.add(row)
                keys.add(key)
            db.flush()
            rebind_written(db, keys)
        self._changed()

    def _changed(self) -> None:
        if self._on_change is not None:
            self._on_change("catalog")
