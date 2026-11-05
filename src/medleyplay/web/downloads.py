"""The downloads API: where a site Track's Download stands, and adding its file by hand."""

from collections.abc import AsyncIterator
from typing import Annotated

import anyio.from_thread
from fastapi import APIRouter, Query, Request
from pydantic import BaseModel
from starlette.requests import ClientDisconnect

from medleyplay.application.manual_downloads import DownloadStatus, TrackDownload
from medleyplay.domain.catalog import TrackId
from medleyplay.domain.errors import InvalidInputError, TooLargeError
from medleyplay.web.deps import ManualDownloadsDep, SignedInAccount
from medleyplay.web.ids import RowId

router = APIRouter(prefix="/api/tracks", tags=["downloads"])

type FileName = Annotated[str, Query(min_length=1, max_length=255, examples=["night-drive.m4a"])]


class TrackDownloadOut(BaseModel):
    """A Track's site Source, its link, and where its Download stands.

    `message` says why a Download failed or is unavailable; `backend` names what made
    a Download that exists, such as `manual` for a file the household added.
    """

    track_id: int
    source_id: int
    kind: str
    link: str
    status: DownloadStatus
    message: str
    backend: str | None

    @classmethod
    def of(cls, download: TrackDownload) -> "TrackDownloadOut":
        """Return the API view of `download`."""
        return cls(
            track_id=download.track_id,
            source_id=download.source_id,
            kind=download.kind,
            link=download.link,
            status=download.status,
            message=download.message,
            backend=download.backend,
        )


@router.get("/{track_id}/download")
def get_download(
    track_id: RowId, _: SignedInAccount, manual: ManualDownloadsDep
) -> TrackDownloadOut:
    """Return where the Track's site Source stands; 409 when it has no site Source."""
    return TrackDownloadOut.of(manual.state(TrackId(track_id)))


@router.put("/{track_id}/download")
def put_download(
    track_id: RowId,
    request: Request,
    name: FileName,
    _: SignedInAccount,
    manual: ManualDownloadsDep,
) -> TrackDownloadOut:
    """Keep the request's body as the Track's Download, `name` being the file's name.

    The body is the file itself, not a form. 413 when it is larger than the limit
    (1 GiB), 422 when its name has no accepted extension or tinytag can't read it as
    audio with a length, 409 when the Track has no site Source. It cancels the Source's
    download Job and replaces any Download it has.
    """
    declared = request.headers.get("content-length", "")
    if declared.isdecimal() and int(declared) > manual.max_bytes:
        message = f"The file is larger than the {manual.max_bytes:,} bytes medleyplay accepts."
        raise TooLargeError(message)
    stream = request.stream()
    with manual.upload(TrackId(track_id), name) as upload:
        try:
            while (chunk := anyio.from_thread.run(_next, stream)) is not None:
                upload.write(chunk)
        except ClientDisconnect:
            message = "The upload stopped before the whole file arrived."
            raise InvalidInputError(message) from None
        return TrackDownloadOut.of(upload.finish())


async def _next(stream: AsyncIterator[bytes]) -> bytes | None:
    """Return the next non-empty chunk of the body, or `None` at its end."""
    async for chunk in stream:
        if chunk:
            return chunk
    return None
