"""Thumbnails of kept images: made ahead by a Job, found by size, tidied with their images.

Each kept image gets a *small* (128-pixel) and a *medium* (512-pixel) thumbnail, as
the domain's `ThumbnailSize` says, in `thumbnails/<recipe>/` beside `covers/`:

```text
thumbnails/1/3f9a…-small     a JPEG, or a PNG for an image with transparency
thumbnails/1/3f9a…-medium
thumbnails/1/3f9a….made      the image is done, even with no thumbnail of a size
thumbnails/1/7c01….unreadable    the thumbnailer couldn't read it
thumbnails/1/no-tool         the thumbnailer had no program to run, and when
```

Reconcile, called `sweep` as the enrichment sweeper calls it, asks one Job of the
kind `make_thumbnails` for up to 500 images with neither mark. It runs at startup,
after an upload, and after Jobs end, so every place an image is kept is covered.
"""

import contextlib
import os
import shutil
from datetime import datetime, timedelta
from functools import partial
from pathlib import Path
from typing import Final

from sqlalchemy.orm import Session

from medleyplay.application import Clock
from medleyplay.application.jobs import JobKind, JobService
from medleyplay.application.plugins import PluginService
from medleyplay.domain.covers import THUMBNAIL_RECIPE, CoverType, ThumbnailSize, cover_type
from medleyplay.domain.covers import is_cover_id as _is_cover_id
from medleyplay.domain.jobs import Job
from medleyplay.plugin_api import THUMBNAILER, ThumbnailStatus
from medleyplay.plugin_api import ThumbnailSize as SizeAsked
from medleyplay.programs.make_thumbnails import (
    MAX_BATCH,
    MadeThumbnailsResult,
    MakeThumbnailsJob,
)

THUMBNAILS_FOLDER: Final = "thumbnails"
"""Where thumbnails are kept, in the data folder, one folder per recipe."""
MAKE_THUMBNAILS_KIND: Final = "make_thumbnails"
THUMBNAILER_KEY: Final = "ffmpeg-thumbnails"
"""The thumbnailer asked: the plugin that runs ffmpeg."""
QUALITY: Final = 4
"""A JPEG thumbnail's quality on ffmpeg's `-q:v` scale, where 2 is best."""
MAX_THUMBNAIL_BYTES: Final = 1024 * 1024
"""A thumbnail larger than this is dropped, and its image marked unreadable."""
NO_TOOL_PAUSE: Final = timedelta(hours=1)
"""How long reconcile waits after the thumbnailer had no program to run."""
TARGET: Final = "thumbnails"
"""The one target of every `make_thumbnails` Job, so one runs at a time."""

_MADE: Final = ".made"
_UNREADABLE: Final = ".unreadable"
_NO_TOOL: Final = "no-tool"

type MakeThumbnailsKind = JobKind[MakeThumbnailsJob, MadeThumbnailsResult]


def recipe_folder(thumbnails_folder: Path) -> Path:
    """Return where this recipe's thumbnails are kept: `thumbnails/1`."""
    return thumbnails_folder / str(THUMBNAIL_RECIPE)


def make_thumbnails_kind(thumbnails_folder: Path, jobs_folder: Path) -> MakeThumbnailsKind:
    """Return the kind of Job that makes thumbnails, moved from `jobs_folder` once it ends."""
    return JobKind(
        name=MAKE_THUMBNAILS_KIND,
        program="medleyplay.programs.make_thumbnails:MAKE_THUMBNAILS_PROGRAM",
        request=MakeThumbnailsJob,
        result=MadeThumbnailsResult,
        complete=partial(
            _complete, folder=recipe_folder(thumbnails_folder), jobs_folder=jobs_folder
        ),
        points=(THUMBNAILER.name,),
    )


class ThumbnailService:
    """Find the thumbnails of kept images, reconcile what is missing, and tidy what is gone."""

    def __init__(
        self,
        clock: Clock,
        plugins: PluginService,
        jobs: JobService,
        kind: MakeThumbnailsKind,
        covers_folder: Path,
        thumbnails_folder: Path,
        *,
        thumbnailer: str = THUMBNAILER_KEY,
    ) -> None:
        """Create a service making thumbnails of the images in `covers_folder`."""
        self._clock = clock
        self._plugins = plugins
        self._jobs = jobs
        self._kind = kind
        self._covers = covers_folder
        self._thumbnails = thumbnails_folder
        self._folder = recipe_folder(thumbnails_folder)
        self._thumbnailer = thumbnailer

    def found(self, name: str, size: ThumbnailSize) -> tuple[Path, CoverType] | None:
        """Return the image `name`'s thumbnail of `size` and its type, or `None` when not made."""
        if not _is_cover_id(name):
            return None
        path = self._folder / f"{name}-{size.value}"
        try:
            with path.open("rb") as file:
                kind = cover_type(file.read(12))
        except OSError:
            return None
        return None if kind is None or path.is_symlink() else (path, kind)

    def sweep(self) -> int:
        """Ask one Job for the images with no thumbnails yet; return how many it asks for.

        Nothing is asked while a Job is active, while the thumbnailer is off, or for an
        hour after it had no program to run.
        """
        if self._thumbnailer not in self._plugins.available_keys().get(THUMBNAILER.name, []):
            return 0
        if self._waiting_for_a_program() or self._jobs.active(MAKE_THUMBNAILS_KIND, TARGET):
            return 0
        names = self._missing()[:MAX_BATCH]
        if not names:
            return 0
        request = MakeThumbnailsJob(
            covers_folder=str(self._covers),
            names=tuple(names),
            sizes=tuple(SizeAsked(label=size.value, pixels=size.pixels) for size in ThumbnailSize),
            quality=QUALITY,
            thumbnailer=self._thumbnailer,
        )
        self._jobs.submit(self._kind, TARGET, request, None)
        return len(names)

    def tidy(self) -> None:
        """Remove older recipes, and the thumbnails and marks of images no longer kept."""
        if self._thumbnails.is_dir():
            for entry in self._thumbnails.iterdir():
                if entry != self._folder:
                    _remove(entry)
        if not self._folder.is_dir():
            return
        kept = set(_names_in(self._covers))
        for entry in self._folder.iterdir():
            image = entry.name[:64]
            if entry.name != _NO_TOOL and image not in kept:
                _remove(entry)

    def _missing(self) -> list[str]:
        done = {
            entry.name.removesuffix(_MADE).removesuffix(_UNREADABLE)
            for entry in _entries(self._folder)
            if entry.name.endswith((_MADE, _UNREADABLE))
        }
        return sorted(name for name in _names_in(self._covers) if name not in done)

    def _waiting_for_a_program(self) -> bool:
        mark = self._folder / _NO_TOOL
        try:
            since = datetime.fromisoformat(mark.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return False
        if self._clock() - since < NO_TOOL_PAUSE:
            return True
        mark.unlink(missing_ok=True)
        return False


def _complete(
    db: Session, job: Job, result: MadeThumbnailsResult, *, folder: Path, jobs_folder: Path
) -> None:
    """Move each thumbnail made into place, and mark each image the thumbnailer answered for.

    No database work: the Job's row is all the transaction changes.
    """
    del db
    work = jobs_folder / str(job.id)
    folder.mkdir(parents=True, exist_ok=True)
    for image in result.images:
        match image.status:
            case ThumbnailStatus.OK:
                made = [work / f"{image.name}-{label}" for label in image.made]
                if all(_is_thumbnail(path) for path in made):
                    for path in made:
                        path.replace(folder / path.name)
                    _mark(folder / f"{image.name}{_MADE}")
                else:
                    _mark(folder / f"{image.name}{_UNREADABLE}")
            case ThumbnailStatus.UNREADABLE:
                _mark(folder / f"{image.name}{_UNREADABLE}")
            case ThumbnailStatus.NO_TOOL:
                (folder / _NO_TOOL).write_text(job_ended_at(job).isoformat(), encoding="utf-8")
            case ThumbnailStatus.TIMED_OUT:
                pass


def job_ended_at(job: Job) -> datetime:
    """Return when the Job ended, or when it started or was made if that isn't recorded yet."""
    return job.finished_at or job.started_at or job.created_at


def _is_thumbnail(path: Path) -> bool:
    try:
        if path.is_symlink() or path.stat().st_size > MAX_THUMBNAIL_BYTES:
            return False
        with path.open("rb") as file:
            return cover_type(file.read(12)) in {CoverType.JPEG, CoverType.PNG}
    except OSError:
        return False


def _mark(path: Path) -> None:
    path.touch()


def _names_in(folder: Path) -> list[str]:
    return [entry.name for entry in _entries(folder) if _is_cover_id(entry.name)]


def _entries(folder: Path) -> list[os.DirEntry[str]]:
    try:
        with os.scandir(folder) as entries:
            return list(entries)
    except OSError:
        return []


def _remove(path: Path) -> None:
    with contextlib.suppress(OSError):
        if path.is_dir() and not path.is_symlink():
            shutil.rmtree(path)
        else:
            path.unlink()
