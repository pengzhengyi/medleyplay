"""The covers API: uploading the household's cover for a Track, and serving a cover by name."""

from typing import Annotated, Any, Final

from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from fastapi.responses import FileResponse, RedirectResponse
from starlette.concurrency import run_in_threadpool

from medleyplay.application.covers import CoverService
from medleyplay.application.details import DetailsService
from medleyplay.domain.catalog import TrackId
from medleyplay.domain.covers import MAX_COVER_BYTES, THUMBNAIL_RECIPE, ThumbnailSize
from medleyplay.web.deps import CoversDep, DetailsDep, SignedInAccount, ThumbnailsDep
from medleyplay.web.details import DetailsOut
from medleyplay.web.ids import RowId

router = APIRouter(prefix="/api", tags=["covers"])

_CACHED: Final = "private, max-age=31536000, immutable"
_COVER_RESPONSES: Final[dict[int | str, dict[str, Any]]] = {
    200: {"content": {"image/jpeg": {}, "image/png": {}, "image/webp": {}}},
    307: {"description": "The thumbnail isn't made: the original instead"},
}


@router.get("/covers/{name}", response_class=FileResponse, responses=_COVER_RESPONSES)
def cover(
    name: str,
    _: SignedInAccount,
    covers: CoversDep,
    thumbnails: ThumbnailsDep,
    size: ThumbnailSize | None = None,
    recipe: Annotated[int | None, Query(ge=0)] = None,
) -> Response:
    """Serve a cover as its bytes say, or its thumbnail of `size` made by `recipe`.

    Its name is its content, so a browser keeps it. A thumbnail not made yet, or made
    by another recipe, sends the browser to the original, without keeping that answer;
    a size a done image has no thumbnail of sends it there for good.
    """
    if (size is None) != (recipe is None):
        message = "Ask for a thumbnail with both a size and a recipe."
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, message)
    found = covers.open(name)
    if found is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"There is no cover {name!r}.")
    if size is not None:
        current = recipe == THUMBNAIL_RECIPE
        thumbnail = thumbnails.found(name, size) if current else None
        if thumbnail is None:
            # A done image's missing size is never made, so that answer is kept too.
            final = current and thumbnails.done(name)
            return RedirectResponse(
                f"/api/covers/{name}",
                status.HTTP_307_TEMPORARY_REDIRECT,
                headers={"Cache-Control": _CACHED if final else "no-store"},
            )
        found = thumbnail
    path, kind = found
    return FileResponse(
        path,
        media_type=kind.value,
        headers={"Cache-Control": _CACHED, "X-Content-Type-Options": "nosniff"},
    )


@router.put(
    "/tracks/{track_id}/cover",
    openapi_extra={
        "requestBody": {"content": {"image/*": {"schema": {"type": "string", "format": "binary"}}}}
    },
)
async def set_cover(
    track_id: RowId,
    request: Request,
    _: SignedInAccount,
    covers: CoversDep,
    details: DetailsDep,
) -> DetailsOut:
    """Make the image in the body the household's cover for the Track."""
    data = bytearray()
    async for chunk in request.stream():
        data += chunk
        if len(data) > MAX_COVER_BYTES:
            message = f"A cover is at most {MAX_COVER_BYTES // (1024 * 1024)} MiB."
            raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, message)
    # Hashing, writing, and waiting on the database go to a thread, clear of the event loop.
    return await run_in_threadpool(_keep_cover, TrackId(track_id), bytes(data), covers, details)


def _keep_cover(
    track_id: TrackId, data: bytes, covers: CoverService, details: DetailsService
) -> DetailsOut:
    covers.set_cover(track_id, data)
    return DetailsOut.of(details.details(track_id))


@router.delete("/tracks/{track_id}/cover")
def remove_cover(
    track_id: RowId, _: SignedInAccount, covers: CoversDep, details: DetailsDep
) -> DetailsOut:
    """Drop the household's cover for the Track, so the next origin's shows."""
    covers.remove_cover(TrackId(track_id))
    return DetailsOut.of(details.details(TrackId(track_id)))
