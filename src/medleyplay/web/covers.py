"""The covers API: uploading the household's cover for a Track, and serving a cover by name."""

from typing import Any, Final

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import FileResponse

from medleyplay.domain.catalog import TrackId
from medleyplay.domain.covers import MAX_COVER_BYTES
from medleyplay.web.deps import CoversDep, DetailsDep, SignedInAccount
from medleyplay.web.details import DetailsOut
from medleyplay.web.ids import RowId

router = APIRouter(prefix="/api", tags=["covers"])

_CACHED: Final = "private, max-age=31536000, immutable"
_COVER_RESPONSES: Final[dict[int | str, dict[str, Any]]] = {
    200: {"content": {"image/jpeg": {}, "image/png": {}, "image/webp": {}}}
}


@router.get("/covers/{name}", response_class=FileResponse, responses=_COVER_RESPONSES)
def cover(name: str, _: SignedInAccount, covers: CoversDep) -> FileResponse:
    """Serve a cover as its bytes say; its name is its content, so a browser keeps it."""
    found = covers.open(name)
    if found is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"There is no cover {name!r}.")
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
    covers.set_cover(TrackId(track_id), bytes(data))
    return DetailsOut.of(details.details(TrackId(track_id)))


@router.delete("/tracks/{track_id}/cover")
def remove_cover(
    track_id: RowId, _: SignedInAccount, covers: CoversDep, details: DetailsDep
) -> DetailsOut:
    """Drop the household's cover for the Track, so the next origin's shows."""
    covers.remove_cover(TrackId(track_id))
    return DetailsOut.of(details.details(TrackId(track_id)))
