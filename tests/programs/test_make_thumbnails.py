"""The thumbnails program: each named image's thumbnails, made in the Job's working folder."""

from pathlib import Path

from medleyplay.plugin_api import ThumbnailSize, ThumbnailStatus
from medleyplay.plugin_host.job import JobContext
from medleyplay.plugin_host.job_wire import DownloadProgress, JobProgress
from medleyplay.plugin_host.loader import load_plugins
from medleyplay.programs.make_thumbnails import (
    MadeThumbnailsResult,
    MakeThumbnailsJob,
    Thumbnailed,
    run,
)
from tests.support.hosts import TEST_PLUGINS
from tests.support.images import gif_image, jpeg_image, png_image

SIZES = (ThumbnailSize(label="small", pixels=128), ThumbnailSize(label="medium", pixels=512))


def kept(folder: Path, name: str, image: bytes) -> str:
    """Keep `image` in `folder` as `name`, and return the name."""
    folder.mkdir(parents=True, exist_ok=True)
    (folder / name).write_bytes(image)
    return name


def context(tmp_path: Path, progress: list[JobProgress] | None = None) -> JobContext:
    """A Job's context working in `tmp_path/work`, calling the sketcher plugin.

    See tests.support.plugins.sketcher; each progress report goes to `progress`.
    """
    work_dir = tmp_path / "work"
    work_dir.mkdir(exist_ok=True)
    reports = [] if progress is None else progress

    def report(frame: JobProgress | DownloadProgress) -> None:
        assert isinstance(frame, JobProgress)
        reports.append(frame)

    return JobContext(work_dir, load_plugins(TEST_PLUGINS, ["sketcher"], lambda _: None), report)


def asked(tmp_path: Path, *names: str) -> MakeThumbnailsJob:
    """Ask the sketcher for the small and medium thumbnails of `names` in `tmp_path/covers`."""
    return MakeThumbnailsJob(
        covers_folder=str(tmp_path / "covers"),
        names=names,
        sizes=SIZES,
        quality=4,
        thumbnailer="sketcher",
    )


def test_each_images_thumbnails_are_written_in_the_working_folder(tmp_path: Path) -> None:
    name = kept(tmp_path / "covers", "a" * 64, jpeg_image("Bremen"))

    result = run(asked(tmp_path, name), context(tmp_path))

    assert result == MadeThumbnailsResult(
        images=(Thumbnailed(name=name, status=ThumbnailStatus.OK, made=("small", "medium")),)
    )
    assert (tmp_path / "work" / f"{name}-small").read_bytes().endswith(b"Bremen small image/jpeg")


def test_the_thumbnailer_is_asked_with_the_kind_the_bytes_say(tmp_path: Path) -> None:
    name = kept(tmp_path / "covers", "b" * 64, png_image("small"))

    result = run(asked(tmp_path, name), context(tmp_path))

    assert result.images == (Thumbnailed(name=name, status=ThumbnailStatus.OK, made=("small",)),)
    assert (tmp_path / "work" / f"{name}-small").read_bytes().endswith(b"small image/png")


def test_a_file_that_is_no_cover_image_is_unreadable_without_asking(tmp_path: Path) -> None:
    name = kept(tmp_path / "covers", "c" * 64, gif_image())

    result = run(asked(tmp_path, name), context(tmp_path))

    assert result.images == (Thumbnailed(name=name, status=ThumbnailStatus.UNREADABLE),)


def test_an_image_no_longer_kept_is_left_out(tmp_path: Path) -> None:
    there = kept(tmp_path / "covers", "d" * 64, jpeg_image())

    result = run(asked(tmp_path, "e" * 64, there), context(tmp_path))

    assert [each.name for each in result.images] == [there]


def test_each_status_the_thumbnailer_answers_is_kept(tmp_path: Path) -> None:
    unreadable = kept(tmp_path / "covers", "1" * 64, jpeg_image("unreadable"))
    timed_out = kept(tmp_path / "covers", "2" * 64, jpeg_image("timed-out"))
    tiny = kept(tmp_path / "covers", "3" * 64, jpeg_image("tiny"))

    result = run(asked(tmp_path, unreadable, timed_out, tiny), context(tmp_path))

    assert result.images == (
        Thumbnailed(name=unreadable, status=ThumbnailStatus.UNREADABLE),
        Thumbnailed(name=timed_out, status=ThumbnailStatus.TIMED_OUT),
        Thumbnailed(name=tiny, status=ThumbnailStatus.OK),
    )


def test_without_the_program_the_rest_are_not_asked(tmp_path: Path) -> None:
    missing = kept(tmp_path / "covers", "4" * 64, jpeg_image("no-tool"))
    after = kept(tmp_path / "covers", "5" * 64, jpeg_image())

    result = run(asked(tmp_path, missing, after), context(tmp_path))

    assert result.images == (Thumbnailed(name=missing, status=ThumbnailStatus.NO_TOOL),)


def test_progress_is_reported_after_each_image(tmp_path: Path) -> None:
    names = [kept(tmp_path / "covers", digit * 64, jpeg_image(digit)) for digit in "67"]
    progress: list[JobProgress] = []

    run(asked(tmp_path, *names), context(tmp_path, progress))

    assert [(each.fraction, each.message) for each in progress] == [
        (0.5, "1 of 2 images"),
        (1.0, "2 of 2 images"),
    ]
