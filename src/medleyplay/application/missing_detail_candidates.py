"""Find genuinely missing Track fields and conservative candidates from the Library."""

import hashlib
import json
import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Final, Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from medleyplay.application.details import (
    OriginValues,
    album_file_values,
    kind_shown_of,
    songs_of,
    values_of,
)
from medleyplay.application.track_artists import artists_of
from medleyplay.domain.artists import NO_ONE, artist_key
from medleyplay.domain.catalog import TrackId
from medleyplay.domain.details import Field, Kind, Origin, Shown, Value, shown
from medleyplay.persistence.schema import TrackRow
from medleyplay.plugin_api.missing_details import ClueField, CreditClues, MissingField

_LOCAL_LIMIT: Final = 3
_PATH: Final = re.compile(r"file://|(?:^|\s)(?:/|~/|\.\.?/|[A-Za-z]:[\\/])|\\", re.IGNORECASE)
_CLUES: Final[tuple[ClueField, ...]] = ("title", "artist", "album", "album_artist")
type CreditIdentity = frozenset[tuple[str, str]]
type CandidateOrigin = Literal["library", "ai"]


@dataclass(frozen=True)
class CreditCandidate:
    """A value to review, and where it came from."""

    value: str
    origin: CandidateOrigin


@dataclass(frozen=True)
class DetailChange:
    """Describe a shown field change, such as year 2005 to blank."""

    field: Field
    before: Value
    after: Value


@dataclass(frozen=True)
class DetailImpact:
    """Describe other fields and split songs to review before saving a suggestion."""

    details: tuple[DetailChange, ...]
    split_songs: int
    affected_songs: int
    song_fields: tuple[Field, ...]


@dataclass(frozen=True)
class MissingTrack:
    """A Track's shown details and fields that are still open to suggestions."""

    track: TrackRow
    kind: Kind
    fields: tuple[MissingField, ...]
    origins: OriginValues
    shown: Mapping[Field, Shown]
    performers: CreditIdentity
    key: str

    def clues(self) -> CreditClues | None:
        """Return identifying music metadata, never file names or inherited values."""
        known = {
            field: value
            for field in _CLUES
            if (detail := self.shown.get(Field(field))) is not None
            and detail.origin not in {Origin.FILE_NAME, Origin.ALBUM_FILE}
            and isinstance(value := detail.value, str)
            and value.strip()
            and not _PATH.search(value)
            and (field not in {"artist", "album_artist"} or artist_key(value) not in NO_ONE)
        }
        if not ({"title", "album"} & known.keys()) or not self.fields:
            return None
        return CreditClues(
            kind="album" if self.kind is Kind.ALBUM else "song", known=known, missing=self.fields
        )

    def review_impact(self, db: Session, field: Field, value: str) -> DetailImpact | None:
        """Return what to review when setting the field cannot use the one-field shortcut."""
        after = shown(
            {
                **self.origins,
                Origin.HOUSEHOLD: {**self.origins.get(Origin.HOUSEHOLD, {}), field: value},
            }
        )
        details = tuple(change for change in _changes(self.shown, after) if change.field != field)
        songs = songs_of(db, TrackId(self.track.id)) if value else []
        if not details and not songs:
            return None
        affected = 0
        song_fields: set[Field] = set()
        for song in songs:
            origins = values_of(db, TrackId(song.track_id))
            inherited = album_file_values(song, after)
            changes = _changes(shown(origins), shown({**origins, Origin.ALBUM_FILE: inherited}))
            if changes:
                affected += 1
                song_fields.update(change.field for change in changes)
        return DetailImpact(details, len(songs), affected, tuple(sorted(song_fields)))


def missing_track(db: Session, track: TrackRow) -> MissingTrack | None:
    """Read the missing fields, ignoring blanks intentionally kept by the household."""
    whole = kind_shown_of(db, track).kind
    origins = values_of(db, TrackId(track.id))
    own = origins.get(Origin.HOUSEHOLD, {})
    fields: list[MissingField] = []
    if not track.album.strip() and Field.ALBUM not in own:
        fields.append("album")
    if whole is Kind.SONG:
        if not track.artist.strip() and Field.ARTIST not in own:
            fields.append("artist")
    elif not (track.album_artist.strip() or track.artist.strip()) and Field.ALBUM_ARTIST not in own:
        fields.append("album_artist")
    if not fields:
        return None
    current = shown(origins)
    performers = _performers(db, track)
    snapshot = (
        track.id,
        whole,
        fields,
        sorted(performers),
        {field: (detail.value, detail.origin) for field, detail in current.items()},
    )
    key = hashlib.sha256(json.dumps(snapshot, sort_keys=True).encode()).hexdigest()
    return MissingTrack(track, whole, tuple(fields), origins, current, performers, key)


def library_candidates(db: Session, track: MissingTrack) -> tuple[CreditCandidate, ...]:
    """Suggest album names only; a compilation credit does not identify a performer."""
    if "album" not in track.fields:
        return ()
    if track.kind is Kind.ALBUM:
        name = track.track.title.strip()
        return (CreditCandidate(name, "library"),) if name else ()
    if not (track.performers and track.track.title.strip()):
        return ()
    donors = db.scalars(
        select(TrackRow)
        .where(
            TrackRow.title == track.track.title, TrackRow.album != "", TrackRow.id != track.track.id
        )
        .order_by(TrackRow.id)
    )
    names: dict[str, CreditCandidate] = {}
    for donor in donors:
        name = donor.album.strip()
        if (
            name
            and _performers(db, donor) == track.performers
            and kind_shown_of(db, donor).kind is Kind.SONG
        ):
            names.setdefault(name.casefold(), CreditCandidate(name, "library"))
            if len(names) == _LOCAL_LIMIT:
                break
    return tuple(names.values())


def _performers(db: Session, track: TrackRow) -> CreditIdentity:
    artists = artists_of(db, TrackId(track.id)).artists
    return frozenset(
        (credit.artist_id, str(credit.role))
        for credit in artists
        if artist_key(credit.written) not in NO_ONE
    )


def _changes(
    before: Mapping[Field, Shown], after: Mapping[Field, Shown]
) -> tuple[DetailChange, ...]:
    return tuple(
        DetailChange(field, old, new)
        for field in Field
        if (old := _shown_value(before, field)) != (new := _shown_value(after, field))
    )


def _shown_value(details: Mapping[Field, Shown], field: Field) -> Value:
    found = details.get(field)
    return "" if found is None else found.value
