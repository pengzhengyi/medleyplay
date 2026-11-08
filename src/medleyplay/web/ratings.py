"""The ratings API: importing your Rate Your Music album ratings, and exporting your ratings."""

from typing import Annotated, Any, Final

from fastapi import APIRouter, Query, Request, Response, status
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from medleyplay.application.ratings import ImportSummary
from medleyplay.domain.errors import TooLargeError
from medleyplay.domain.rym import MAX_EXPORT_BYTES
from medleyplay.web.deps import RatingsDep, SignedInAccount

router = APIRouter(prefix="/api", tags=["ratings"])

_BOM: Final = "﻿"
_CSV_BODY: Final[dict[str, Any]] = {
    "requestBody": {"content": {"text/csv": {"schema": {"type": "string", "format": "binary"}}}}
}


class AlbumOut(BaseModel):
    """An album by its artist and name, as the export names it."""

    artist: str
    album: str


class PlaylistChangeOut(BaseModel):
    """How many songs join, and leave, one of your smart playlists."""

    id: str
    name: str
    joining: int
    leaving: int


class ImportSummaryOut(BaseModel):
    """What importing an export changes, or changed, for you."""

    albums: int = Field(description="The albums the export rates or reviews.")
    matched_albums: int = Field(description="Of those, the albums the Library has.")
    songs: int = Field(description="The songs whose rating changes.")
    unmatched: list[AlbumOut] = Field(description="The albums the Library hasn't, in file order.")
    playlists: list[PlaylistChangeOut] = Field(
        description="Your smart playlists songs join or leave."
    )
    replaced_albums: int = Field(description="The albums of the earlier import this replaces.")

    @classmethod
    def of(cls, summary: ImportSummary) -> "ImportSummaryOut":
        """Return the API view of `summary`."""
        return cls(
            albums=summary.albums,
            matched_albums=summary.matched_albums,
            songs=summary.songs,
            unmatched=[AlbumOut(artist=artist, album=album) for artist, album in summary.unmatched],
            playlists=[
                PlaylistChangeOut(
                    id=str(each.playlist_id),
                    name=each.name,
                    joining=each.joining,
                    leaving=each.leaving,
                )
                for each in summary.playlists
            ],
            replaced_albums=summary.replaced_albums,
        )


class AlbumRatingOut(BaseModel):
    """Your imported rating of an album, if you rated it, and your review."""

    stars: int | None
    note: str


@router.post("/ratings/import/preview", openapi_extra=_CSV_BODY)
async def preview_import(
    request: Request, me: SignedInAccount, ratings: RatingsDep
) -> ImportSummaryOut:
    """Check a Rate Your Music export and answer what importing it would change."""
    data = await _export_in(request)
    return ImportSummaryOut.of(await run_in_threadpool(ratings.preview_import, me.id, data))


@router.post("/ratings/import", openapi_extra=_CSV_BODY)
async def import_ratings(
    request: Request, me: SignedInAccount, ratings: RatingsDep
) -> ImportSummaryOut:
    """Replace your imported album ratings with a Rate Your Music export's."""
    data = await _export_in(request)
    return ImportSummaryOut.of(await run_in_threadpool(ratings.import_ratings, me.id, data))


class ImportKeptOut(BaseModel):
    """The import you keep: how many albums it rated or reviewed, 0 for none."""

    albums: int


@router.get("/ratings/import")
def import_kept(me: SignedInAccount, ratings: RatingsDep) -> ImportKeptOut:
    """Answer how many albums your last import rated or reviewed."""
    return ImportKeptOut(albums=ratings.imported_albums(me.id))


@router.delete("/ratings/import", status_code=status.HTTP_204_NO_CONTENT)
def forget_import(me: SignedInAccount, ratings: RatingsDep) -> None:
    """Forget the album ratings you imported; the ratings you gave songs here stay."""
    ratings.forget_import(me.id)


@router.get("/album-rating")
def album_rating(
    me: SignedInAccount,
    ratings: RatingsDep,
    artist: Annotated[str, Query(max_length=512)],
    album: Annotated[str, Query(max_length=512)],
) -> AlbumRatingOut | None:
    """Return your imported rating of the Library album `album` by `artist`, or `null`."""
    found = ratings.album_rating(me.id, artist, album)
    return None if found is None else AlbumRatingOut(stars=found.stars, note=found.note)


@router.get(
    "/ratings/export", response_class=Response, responses={200: {"content": {"text/csv": {}}}}
)
def export_ratings(me: SignedInAccount, ratings: RatingsDep) -> Response:
    """Download your ratings: the songs you rated, then the albums you imported.

    The file starts with a byte order mark, so a spreadsheet reads it as UTF-8.
    """
    exported = ratings.export(me.id)
    return Response(
        (_BOM + exported.text).encode(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{exported.file_name}"'},
    )


async def _export_in(request: Request) -> bytes:
    """Return the request's body, refused once it is over an export's size."""
    too_large = TooLargeError(
        f"A Rate Your Music export is at most {MAX_EXPORT_BYTES // (1024 * 1024)} MiB."
    )
    declared = request.headers.get("content-length", "")
    if declared.isdecimal() and int(declared) > MAX_EXPORT_BYTES:
        raise too_large
    data = bytearray()
    async for chunk in request.stream():
        data += chunk
        if len(data) > MAX_EXPORT_BYTES:
            raise too_large
    return bytes(data)
