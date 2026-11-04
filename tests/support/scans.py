"""Running the scan program over a folder or archive, and keeping what a catalog would."""

from pathlib import Path

from medleyplay.plugin_host.job import JobContext
from medleyplay.plugin_host.loader import BUILT_IN_PLUGINS, load_plugins
from medleyplay.programs.scan_covers import ImageStamp
from medleyplay.programs.scan_library import KnownFile, ScanLibrary, ScannedFile, Stamp, run
from tests.support.libraries import LIBRARY_PLUGINS


def job_context(tmp_path: Path) -> JobContext:
    """Return the context of a Job working in `tmp_path/work`, with the Library plugins loaded."""
    work_dir = tmp_path / "work"
    work_dir.mkdir(exist_ok=True)
    endpoints = load_plugins(BUILT_IN_PLUGINS, LIBRARY_PLUGINS, lambda _: None)
    return JobContext(work_dir, endpoints, lambda _: None)


def scan_files(
    tmp_path: Path,
    root: Path,
    kind: str = "folder",
    *,
    known: dict[str, KnownFile] | None = None,
    full: bool = False,
) -> dict[str, ScannedFile]:
    """Scan `root` for `.wav` files, and return what was found by path."""
    request = ScanLibrary.model_validate(
        {
            "root": {"kind": kind, "path": str(root)},
            "extensions": ["wav"],
            "known": known or {},
            "full": full,
        }
    )
    scan = run(request, job_context(tmp_path))
    assert scan.readable
    return {file.path: file for file in scan.files}


def known_after(found: dict[str, ScannedFile]) -> dict[str, KnownFile]:
    """Return what a catalog keeps of a scan: each file's stamp, and its sidecar's and image's."""
    return {
        path: KnownFile(
            size=file.size,
            modified_ns=file.modified_ns,
            info_json=None
            if file.info_json is None
            else Stamp(size=file.info_json.size, modified_ns=file.info_json.modified_ns),
            cover_image=None
            if file.cover_image is None
            else ImageStamp(
                extension=file.cover_image.extension,
                size=file.cover_image.size,
                modified_ns=file.cover_image.modified_ns,
            ),
        )
        for path, file in found.items()
    }
