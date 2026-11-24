"""The program that downloads one part of a site's video into the Job's folder, and checks it.

The plugin downloads into `download/`, an empty folder of its own, and names the
file it made; the program trusts the name only once the file proves to be a
plain, non-empty file of an accepted type, directly in that folder.
"""

import os
import shutil
import stat
from pathlib import Path, PurePosixPath
from typing import Annotated, Final, Literal, NoReturn, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from medleyplay.download_limits import MAX_JOIN_INPUT_BYTES, disk_floor
from medleyplay.plugin_api import DOWNLOAD_PART, DownloadPart, PartNumber, QualityId, VideoId
from medleyplay.plugin_host.job import (
    AnswerFailedError,
    JobContext,
    JobProgram,
    PluginCallFailedError,
)
from medleyplay.programs.joined_audio import file_limit, join_audio, join_tools

DOWNLOAD_FOLDER: Final = "download"
_OPEN_FLAGS: Final = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK


class _Model(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class DownloadSource(_Model):
    """Download one part or a joined selection of a video as one file."""

    site: str
    video: VideoId
    part: PartNumber | None = Field(default=None, exclude_if=lambda value: value is None)
    parts: Annotated[tuple[PartNumber, ...], Field(min_length=1)] | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    lane: Literal["join"] | None = Field(default=None, exclude_if=lambda value: value is None)
    quality: QualityId
    extensions: frozenset[str]
    max_bytes: int

    @model_validator(mode="after")
    def check_selection(self) -> Self:
        """Check that the request has one form and any joined parts are in video order."""
        multiple = self.parts is not None and len(self.parts) > 1
        if (
            (self.part is None) == (self.parts is None)
            or (self.parts is not None and self.parts != tuple(sorted(set(self.parts))))
            or multiple != (self.lane is not None)
        ):
            message = "A download must name one part or a distinct, ordered selection."
            raise ValueError(message)
        return self


class DownloadedSource(_Model):
    """The checked file's name in the download folder, or why there is none."""

    file: str | None
    gone: bool = False
    message: str = ""
    quality: str = ""
    backend: str = ""
    size: int = 0
    duration_ms: int | None = None


def run(request: DownloadSource, context: JobContext) -> DownloadedSource:
    """Download the selection with the Job's login and proxy and check the file."""
    folder = context.work_dir / DOWNLOAD_FOLDER
    folder.mkdir(exist_ok=True)
    if request.parts is not None and len(request.parts) > 1:
        return _join(request, context, folder, request.parts)
    part = request.part if request.parts is None else request.parts[0]
    if part is None:  # pragma: no cover -- the request model requires a selection
        message = "The download request has no part."
        raise ValueError(message)
    result = _download_part(request, context, folder, part)
    if request.parts is not None and result.file is None:
        message = f"Part {part}: {result.message}"
        raise AnswerFailedError(message, kind="invalid")
    return result


def _download_part(
    request: DownloadSource, context: JobContext, folder: Path, part: int, *, bounded: bool = False
) -> DownloadedSource:
    downloaded = context.call(
        DOWNLOAD_PART,
        request.site,
        DownloadPart(
            video=request.video,
            part=part,
            quality=request.quality,
            folder=str(folder),
            login=str(context.login) if context.login else None,
            proxy=context.proxy,
            bounded_http=bounded,
        ),
    )
    if downloaded.file is None:
        message = downloaded.message or "The site no longer has it."
        return DownloadedSource(file=None, gone=True, message=message)
    size = _check(folder, downloaded.file, request, part)
    return DownloadedSource(
        file=downloaded.file,
        quality=downloaded.quality or request.quality,
        backend=downloaded.backend,
        size=size,
    )


def _join(
    request: DownloadSource, context: JobContext, folder: Path, parts: tuple[int, ...]
) -> DownloadedSource:
    tools = join_tools()
    if tools is None:
        message = "Joining several parts requires FFmpeg and ffprobe. Use Separate files instead."
        raise AnswerFailedError(message, kind="refused")
    left = MAX_JOIN_INPUT_BYTES
    inputs = []
    for index, part in enumerate(parts):
        _disk_room(folder, left + request.max_bytes)
        context.report(
            index / (2 * len(parts)), f"Downloading part {part} ({index + 1}/{len(parts)})"
        )
        part_dir = folder / str(index)
        part_dir.mkdir()
        with file_limit(left):
            fetched = _download_part(request, context, part_dir, part, bounded=True)
        if fetched.file is None:
            message = f"Part {part}: {fetched.message}"
            raise AnswerFailedError(message, kind="invalid")
        if fetched.size > left or set(part_dir.iterdir()) != {part_dir / fetched.file}:
            message = f"Part {part} did not finish as one file within the temporary download limit."
            raise AnswerFailedError(message, kind="invalid")
        left -= fetched.size
        inputs.append(part_dir / fetched.file)
    _disk_room(folder, request.max_bytes)

    def joining(index: int) -> None:
        context.report(
            (len(parts) + index) / (2 * len(parts)),
            f"Joining part {parts[index]} ({index + 1}/{len(parts)})",
        )

    output = folder / "album.m4a"
    duration_ms = join_audio(tools, inputs, output, request.max_bytes, on_part=joining)
    size = _check(folder, output.name, request, parts[-1])
    return DownloadedSource(
        file=output.name, size=size, quality="aac-256k", backend="ffmpeg", duration_ms=duration_ms
    )


def _disk_room(folder: Path, needed: int) -> None:
    disk = shutil.disk_usage(folder)
    if disk.free - needed < disk_floor(disk.total):
        message = "There is not enough temporary disk space to join this album."
        raise AnswerFailedError(message, kind="refused")


def _check(folder: Path, name: str, request: DownloadSource, part: int) -> int:
    """Return the size of the file the plugin named, synced to disk, or fail as a plugin fault."""
    suffix = PurePosixPath(name).suffix.lower().removeprefix(".")
    if PurePosixPath(name).name != name or name in {".", ".."} or "\\" in name:
        _refuse(request, part, f"named {name!r}, which isn't a file directly in its folder")
    if suffix not in request.extensions:
        _refuse(request, part, f"made {name!r}, which isn't an accepted type of audio")
    try:
        descriptor = os.open(folder / name, _OPEN_FLAGS)
    except OSError as error:
        _refuse(request, part, f"named {name!r}, which can't be opened: {error.strerror}")
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode):
            _refuse(request, part, f"named {name!r}, which isn't a regular file")
        if not 0 < info.st_size <= request.max_bytes:
            _refuse(request, part, f"made {name!r}, {info.st_size} bytes long")
        os.fsync(descriptor)
        return info.st_size
    finally:
        os.close(descriptor)


def _refuse(request: DownloadSource, part: int, why: str) -> NoReturn:
    message = f"The download of {request.video} part {part} {why}."
    raise PluginCallFailedError(kind="plugin", message=message, plugin=None, key=request.site)


DOWNLOAD_SOURCE: JobProgram[DownloadSource, DownloadedSource] = JobProgram(
    DownloadSource, DownloadedSource, run
)
