"""The details API: a Track's values and where each came from, and the household's own.

It also lists the artist and album names written with more than the name in them,
and tidies or keeps each one.
"""

from collections.abc import Mapping
from typing import Annotated, Final, Literal

from fastapi import APIRouter, status
from pydantic import BaseModel, Field, StrictInt, StrictStr

from medleyplay.application.details import DetailsView, NameToTidy, VideoRead
from medleyplay.domain.catalog import TrackId
from medleyplay.domain.details import Field as Detail
from medleyplay.domain.details import Kind, KindReason, Origin, Shown
from medleyplay.domain.tidy import NameKind
from medleyplay.domain.video_text import VideoText
from medleyplay.web.deps import DetailsDep, SignedInAccount
from medleyplay.web.ids import RowId

router = APIRouter(prefix="/api/tracks", tags=["details"])
names_router = APIRouter(prefix="/api/names-to-tidy", tags=["details"])

# Strict, so JSON `true` or `3.0` is refused rather than taken as a whole number.
type DetailValue = StrictStr | StrictInt


class ShownOut(BaseModel):
    """The value a field shows, and the origin it came from."""

    value: DetailValue
    origin: Origin


class KindOut(BaseModel):
    """Whether the Track is a song or an album, and why.

    An origin names it, its file is split, it is a song of a split file, or its
    file's length suggests it.
    """

    value: Kind
    reason: KindReason


class VideoTextIn(BaseModel):
    """A video's title and description, as the site shows them."""

    title: Annotated[StrictStr, Field(max_length=1_000)] = Field(examples=["ハチ 全专《Bremen》"])
    description: Annotated[StrictStr, Field(max_length=20_000)] = Field(
        default="", examples=["00:00 アイネクライネ\n04:12 ゴーゴー幽霊船 - ハチ"]
    )


class VideoTextOut(BaseModel):
    """The video's text the `video` values were read from."""

    title: str
    description: str


class DetailsOut(BaseModel):
    """A Track's shown values, what each origin says, and what would show without the household.

    A field no origin gives is absent from `shown`; `found` is what would show if the
    household's values were dropped. `video_text` is the video's text the `video`
    values were read from, if any was.
    """

    track_id: int
    shown: dict[str, ShownOut]
    found: dict[str, ShownOut]
    origins: dict[Origin, dict[str, DetailValue]]
    video_text: VideoTextOut | None
    kind: KindOut

    @classmethod
    def of(cls, view: DetailsView) -> "DetailsOut":
        """Return the API view of `view`."""
        return cls(
            track_id=view.track_id,
            shown=_shown_out(view.shown),
            found=_shown_out(view.found),
            origins={
                origin: {str(field): value for field, value in values.items()}
                for origin, values in view.values.items()
            },
            video_text=None
            if view.video_text is None
            else VideoTextOut(title=view.video_text.title, description=view.video_text.description),
            kind=KindOut(value=view.kind.kind, reason=view.kind.reason),
        )


class SongOut(BaseModel):
    """A song of a song list: where it starts, its title, and its artist, or ""."""

    start_ms: int
    title: str
    artist: str


class VideoReadOut(BaseModel):
    """A Track's details once its video's text is read, and the songs that text lists."""

    details: DetailsOut
    songs: list[SongOut]

    @classmethod
    def of(cls, read: VideoRead) -> "VideoReadOut":
        """Return the API view of `read`."""
        return cls(
            details=DetailsOut.of(read.details),
            songs=[
                SongOut(start_ms=song.start_ms, title=song.title, artist=song.artist)
                for song in read.songs
            ],
        )


def _shown_out(values: Mapping[Detail, Shown]) -> dict[str, ShownOut]:
    return {
        field: ShownOut(value=found.value, origin=found.origin) for field, found in values.items()
    }


class HouseholdIn(BaseModel):
    """The household's values: text, empty to show nothing, or whole numbers."""

    values: dict[str, DetailValue] = Field(
        examples=[{"title": "Night Drive", "artist": "Blue Room", "year": 2016}]
    )


class ManyIn(BaseModel):
    """Household values to set on several Tracks; `null` drops one, so the next origin shows."""

    track_ids: Annotated[list[RowId], Field(min_length=1, max_length=10_000)]
    values: dict[str, DetailValue | None] = Field(
        examples=[{"album": "Re:Start", "album_artist": "wowaka"}]
    )


class ManyOut(BaseModel):
    """How many Tracks changed."""

    changed: int


@router.get("/{track_id}/details")
def details(track_id: RowId, _: SignedInAccount, service: DetailsDep) -> DetailsOut:
    """Return the Track's shown values, and what each origin says."""
    return DetailsOut.of(service.details(TrackId(track_id)))


@router.put("/{track_id}/details")
def put_details(
    track_id: RowId, body: HouseholdIn, _: SignedInAccount, service: DetailsDep
) -> DetailsOut:
    """Make `values` the household's values for the Track, replacing its earlier ones."""
    return DetailsOut.of(service.put_household(TrackId(track_id), body.values))


@router.post("/details")
def set_on_many(body: ManyIn, _: SignedInAccount, service: DetailsDep) -> ManyOut:
    """Set the given household values on every Track named; either all change or none."""
    return ManyOut(changed=service.set_on_many(map(TrackId, body.track_ids), body.values))


@router.post("/{track_id}/video-text")
def read_video_text(
    track_id: RowId, body: VideoTextIn, _: SignedInAccount, service: DetailsDep
) -> VideoReadOut:
    """Read a video's pasted title and description as the Track's `video` values."""
    read = service.read_video_text(TrackId(track_id), VideoText(body.title, body.description))
    return VideoReadOut.of(read)


_FIELD_NAMES: Final[dict[Detail, Literal["artist", "album_artist", "album"]]] = {
    Detail.ARTIST: "artist",
    Detail.ALBUM_ARTIST: "album_artist",
    Detail.ALBUM: "album",
}


class NameToTidyOut(BaseModel):
    """An artist's or album's name shown on Tracks with more than the name in it, tidied."""

    kind: Literal["artist", "album"]
    written: str = Field(description="The name exactly as the Tracks show it.")
    name: str = Field(description="The name with the rest taken off.")
    year: int | None = Field(description="The release year the written name gave, if any.")
    fields: list[Literal["artist", "album_artist", "album"]] = Field(
        description="Where the Tracks show it: as the artist, the album artist, or the album."
    )
    track_ids: list[int] = Field(description="The Tracks showing it, oldest first.")
    years_differ: int = Field(
        description="How many of them show another year, which tidying keeps."
    )

    @classmethod
    def of(cls, found: NameToTidy) -> "NameToTidyOut":
        """Return the API view of `found`."""
        return cls(
            kind="artist" if found.kind is NameKind.ARTIST else "album",
            written=found.written,
            name=found.tidied.name,
            year=found.tidied.year,
            fields=[_FIELD_NAMES[field] for field in found.fields],
            track_ids=list(found.track_ids),
            years_differ=found.years_differ,
        )


class NamesToTidyOut(BaseModel):
    """The names to tidy, those on the most Tracks first."""

    names: list[NameToTidyOut]


class NameIn(BaseModel):
    """One artist's or album's name, as the Tracks show it."""

    kind: Literal["artist", "album"]
    written: str = Field(min_length=1, max_length=512)


@names_router.get("")
def names_to_tidy(_: SignedInAccount, service: DetailsDep) -> NamesToTidyOut:
    """Return the artist names with more than the name in them, with their tidy form."""
    return NamesToTidyOut(names=[NameToTidyOut.of(found) for found in service.names_to_tidy()])


@names_router.post("/tidy")
def tidy_name(body: NameIn, _: SignedInAccount, service: DetailsDep) -> ManyOut:
    """Show the name's tidy form on every Track showing it, and its year where none shows."""
    return ManyOut(changed=service.tidy_name(NameKind(body.kind), body.written))


@names_router.post("/keep", status_code=status.HTTP_204_NO_CONTENT)
def keep_name(body: NameIn, _: SignedInAccount, service: DetailsDep) -> None:
    """Keep the name as written, so it is no longer offered for tidying."""
    service.keep_name(NameKind(body.kind), body.written)
