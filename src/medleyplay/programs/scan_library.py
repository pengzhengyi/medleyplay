"""The program of a Library scan: list the files, then read what changed since the last scan."""

import time
from collections.abc import Iterable
from typing import Final

from pydantic import BaseModel, ConfigDict

from medleyplay.plugin_api import (
    CHECK_ROOT,
    FINGERPRINT_FILE,
    LIST_FILES,
    LOCATE_FILE,
    READ_TAGS,
    CheckRoot,
    FileRequest,
    LibraryFile,
    LibraryPath,
    LibraryRoot,
    ListFiles,
    ReadTags,
    Tags,
)
from medleyplay.plugin_host.job import JobContext, JobProgram, PluginCallFailedError
from medleyplay.programs.info_json import MAX_BYTES, InfoJsonError, InfoText, parse_info_json
from medleyplay.programs.library_files import (
    FileGoneError,
    FileTooLargeError,
    extension_of,
    fetched,
    name_of,
    read_whole,
)
from medleyplay.programs.scan_covers import (
    COPIES_FOLDER,
    COVER_EXTENSIONS,
    CopyFolder,
    CoverFile,
    CoverImage,
    ImageStamp,
    detach_cover,
    images_beside,
    read_image,
)

REPORT_EVERY: Final = 1.0
"""Seconds between progress reports."""
SIDECAR_SUFFIX: Final = ".info.json"
"""The name's end of the file yt-dlp writes beside `<name>.m4a`: `<name>.info.json`."""


class _Model(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class Stamp(_Model):
    """A file's size and modified time, which tell whether it changed."""

    size: int
    modified_ns: int


class KnownFile(_Model):
    """What the last scan recorded about a file whose tags it read.

    `info_json` is the stamp of the `.info.json` beside it when the last scan found
    one, and `cover_image` that of the image beside it.
    """

    size: int
    modified_ns: int
    info_json: Stamp | None = None
    cover_image: ImageStamp | None = None


class ScanLibrary(_Model):
    """Scan `root` for files with `extensions`; skip known files that haven't changed.

    With `full`, every file is read again.
    """

    root: LibraryRoot
    extensions: frozenset[str]
    known: dict[LibraryPath, KnownFile]
    full: bool = False


class InfoJson(_Model):
    """The `.info.json` beside a file: its stamp, and what reading it gave.

    A sidecar the scan skipped as unchanged has neither `text` nor `error`. One it
    read has the `text`, or the `error` when it couldn't be read as a video's details;
    `retry` says the error may pass, as when its drive answered too late, so the next
    scan reads it again.
    """

    size: int
    modified_ns: int
    text: InfoText | None = None
    error: str = ""
    retry: bool = False


class ScannedFile(_Model):
    """One file the scan found.

    An unchanged file has no fingerprint or tags. A file whose tags couldn't be read
    has the `error` instead. `info_json` is the sidecar beside the file, if there is
    one, and `cover_image` the image beside it. `embedded_cover` is a copy of the
    cover in the file's tags, which are reported without it.
    """

    path: LibraryPath
    size: int
    modified_ns: int
    changed: bool
    fingerprint: str | None = None
    tags: Tags | None = None
    error: str = ""
    info_json: InfoJson | None = None
    cover_image: CoverImage | None = None
    embedded_cover: CoverFile | None = None


class LibraryScan(_Model):
    """What the scan found: every file, or why the root couldn't be read."""

    readable: bool
    message: str = ""
    files: tuple[ScannedFile, ...] = ()


def run(request: ScanLibrary, context: JobContext) -> LibraryScan:
    """Scan the root."""
    kind = request.root.kind
    check = context.call(CHECK_ROOT, kind, CheckRoot(root=request.root))
    if not check.readable:
        return LibraryScan(readable=False, message=check.message)
    extensions = request.extensions | {"json", *COVER_EXTENSIONS}
    listing = context.call(LIST_FILES, kind, ListFiles(root=request.root, extensions=extensions))
    audio, sidecars, images = _split(listing.files, request.extensions)
    copies = CopyFolder(context.work_dir / COPIES_FOLDER)
    scanned: list[ScannedFile] = []
    reported = time.monotonic()
    for done, file in enumerate(audio):
        if time.monotonic() - reported >= REPORT_EVERY:
            context.report(done / len(audio), f"Read {done} of {len(audio)} files")
            reported = time.monotonic()
        known = request.known.get(file.path)
        unchanged = known is not None and _stamp(file) == Stamp(
            size=known.size, modified_ns=known.modified_ns
        )
        if unchanged and not request.full:
            scanned_file = _file(file, changed=False)
        else:
            scanned_file = _read(request.root, file, copies, context)
        name = name_of(file.path)
        if (sidecar := sidecars.get(name)) is not None:
            info = _info_json(request, sidecar, known, context)
            scanned_file = scanned_file.model_copy(update={"info_json": info})
        if (image := images.get(name)) is not None:
            beside = read_image(
                request.root,
                image,
                None if known is None else known.cover_image,
                copies,
                context,
                full=request.full,
            )
            scanned_file = scanned_file.model_copy(update={"cover_image": beside})
        scanned.append(scanned_file)
    return LibraryScan(readable=True, files=tuple(scanned))


def _split(
    listed: Iterable[LibraryFile], extensions: frozenset[str]
) -> tuple[list[LibraryFile], dict[str, LibraryFile], dict[str, LibraryFile]]:
    """Split a listing into the audio files, and their sidecars and images by the name they share.

    `Blue/a.m4a`, `Blue/a.info.json`, and `Blue/a.jpg` share `Blue/a`. A sidecar or
    image with no audio file beside it, and any other file, is left out.
    """
    files = list({file.path: file for file in listed}.values())
    audio = [file for file in files if extension_of(file.path) in extensions]
    names = {name_of(file.path) for file in audio}
    sidecars = {
        file.path[: -len(SIDECAR_SUFFIX)]: file
        for file in files
        if file.path.lower().endswith(SIDECAR_SUFFIX)
    }
    return (
        audio,
        {name: sidecar for name, sidecar in sidecars.items() if name in names},
        images_beside(files, names),
    )


def _stamp(file: LibraryFile) -> Stamp:
    return Stamp(size=file.size, modified_ns=file.modified_ns)


def _file(file: LibraryFile, *, changed: bool) -> ScannedFile:
    return ScannedFile(
        path=file.path, size=file.size, modified_ns=file.modified_ns, changed=changed
    )


def _read(
    root: LibraryRoot, file: LibraryFile, copies: CopyFolder, context: JobContext
) -> ScannedFile:
    request = FileRequest(root=root, path=file.path)
    extension = extension_of(file.path)
    try:
        location = context.call(LOCATE_FILE, root.kind, request)
        if location.missing:  # pragma: no cover -- a file removed between listing and reading
            return _file(file, changed=True).model_copy(update={"error": "The file is gone."})
        fingerprint = context.call(FINGERPRINT_FILE, root.kind, request).value
        if location.compressed or location.local_path is None:
            tags = _read_fetched(root, file, extension, context)
        else:
            read = ReadTags(
                local_path=location.local_path, offset=location.offset, length=location.length
            )
            tags = context.call(READ_TAGS, extension, read)
    except PluginCallFailedError as error:
        return _file(file, changed=True).model_copy(update={"error": str(error)})
    tags, embedded = detach_cover(tags, copies)
    return _file(file, changed=True).model_copy(
        update={"fingerprint": fingerprint, "tags": tags, "embedded_cover": embedded}
    )


def _read_fetched(
    root: LibraryRoot, file: LibraryFile, extension: str, context: JobContext
) -> Tags:
    with fetched(root, file.path, context) as copy:
        return context.call(READ_TAGS, extension, ReadTags(local_path=str(copy)))


def _info_json(
    request: ScanLibrary, sidecar: LibraryFile, known: KnownFile | None, context: JobContext
) -> InfoJson:
    """Report the sidecar, reading it when it is new, changed, or the scan is full."""
    stamp = _stamp(sidecar)
    unchanged = known is not None and known.info_json == stamp
    listed = InfoJson(size=sidecar.size, modified_ns=sidecar.modified_ns)
    if unchanged and not request.full:
        return listed
    try:
        text = parse_info_json(_contents(request.root, sidecar, context))
    except InfoJsonError as error:
        return listed.model_copy(update={"error": str(error)})
    except (PluginCallFailedError, OSError) as error:
        failed = f"can't be read ({type(error).__name__})"
        return listed.model_copy(update={"error": failed, "retry": True})
    return listed.model_copy(update={"text": text})


def _contents(root: LibraryRoot, sidecar: LibraryFile, context: JobContext) -> bytes:
    """Return the sidecar's bytes, or raise `InfoJsonError` when it is gone or too large."""
    try:
        return read_whole(root, sidecar, context, MAX_BYTES)
    except FileGoneError:
        message = "is gone"
        raise InfoJsonError(message) from None
    except FileTooLargeError as error:
        message = f"is too large ({error})"
        raise InfoJsonError(message) from None


SCAN_LIBRARY: JobProgram[ScanLibrary, LibraryScan] = JobProgram(ScanLibrary, LibraryScan, run)
