"""Thumbnails of kept images: found by size, made ahead by a Job, and tidied with their images."""

import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path

import pytest
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.job_runner import JobProcesses, JobRunner
from medleyplay.application.jobs import JobService
from medleyplay.application.thumbnails import (
    MAKE_THUMBNAILS_KIND,
    ThumbnailService,
    make_thumbnails_kind,
)
from medleyplay.domain.covers import THUMBNAIL_RECIPE, CoverType, ThumbnailSize, cover_id
from medleyplay.domain.jobs import Job, JobState
from medleyplay.persistence.schema import JobRow
from medleyplay.plugin_api import ThumbnailStatus
from medleyplay.programs.make_thumbnails import MadeThumbnailsResult, MakeThumbnailsJob, Thumbnailed
from tests.support.fakes import FakeClock
from tests.support.hosts import TEST_COMMAND, TEST_PLUGINS, started_plugins
from tests.support.images import jpeg_image, png_image

WAIT = 20.0


@dataclass
class Thumbnails:
    """A thumbnail service over `data/covers`, its Jobs, and the runner, not yet started."""

    service: ThumbnailService
    jobs: JobService
    runner: JobRunner
    units: sessionmaker[Session]
    data: Path

    @property
    def covers(self) -> Path:
        """Where the images are kept."""
        return self.data / "covers"

    @property
    def made(self) -> Path:
        """Where this recipe's thumbnails are kept: `data/thumbnails/1`."""
        return self.data / "thumbnails" / str(THUMBNAIL_RECIPE)

    def keep(self, image: bytes) -> str:
        """Keep `image` as a cover, and return its name."""
        self.covers.mkdir(parents=True, exist_ok=True)
        name = cover_id(image)
        (self.covers / name).write_bytes(image)
        return name

    def active(self) -> Job | None:
        """The `make_thumbnails` Job waiting or running, if any."""
        return self.jobs.active(MAKE_THUMBNAILS_KIND, "thumbnails")

    def asked(self) -> MakeThumbnailsJob:
        """What the active Job asks."""
        job = self.active()
        assert job is not None
        with self.units() as db:
            row = db.get(JobRow, job.id)
            assert row is not None
            return MakeThumbnailsJob.model_validate(row.request)

    def run_until_done(self) -> None:
        """Run the Job reconcile submitted, and wait until it succeeds."""
        job = self.active()
        assert job is not None
        self.runner.start()
        ends = time.monotonic() + WAIT
        while time.monotonic() < ends:
            state = self.jobs.get_job(job.id).job.state
            if state is JobState.SUCCEEDED:
                return
            assert state not in {JobState.FAILED, JobState.CANCELLED}, self.jobs.get_job(job.id)
            time.sleep(0.05)
        message = f"The Job is still {self.jobs.get_job(job.id).job.state}."
        raise AssertionError(message)


@contextmanager
def thumbnails_over(
    units: sessionmaker[Session], clock: FakeClock, data: Path, *, plugin: bool = True
) -> Iterator[Thumbnails]:
    """Run the thumbnail service with the sketcher plugin, on unless `plugin` is false.

    See tests.support.plugins.sketcher: an image's label says how it answers.
    """
    kind = make_thumbnails_kind(data / "thumbnails", data / "jobs")
    with started_plugins(units, clock, *(("sketcher",) if plugin else ())) as plugins:
        runner = JobRunner(
            units,
            clock,
            {kind.name: kind},
            plugins,
            data / "jobs",
            processes=JobProcesses(TEST_COMMAND, TEST_PLUGINS),
            poll=timedelta(seconds=0.1),
        )
        jobs = JobService(units, clock, {kind.name: kind}, runner)
        service = ThumbnailService(
            clock, plugins, jobs, kind, data / "covers", data / "thumbnails", thumbnailer="sketcher"
        )
        try:
            yield Thumbnails(service, jobs, runner, units, data)
        finally:
            runner.stop()


@pytest.fixture
def thumbnails(
    units: sessionmaker[Session], clock: FakeClock, tmp_path: Path
) -> Iterator[Thumbnails]:
    with thumbnails_over(units, clock, tmp_path / "data") as running:
        yield running


def test_reconcile_asks_one_job_for_every_image_without_thumbnails(
    thumbnails: Thumbnails,
) -> None:
    names = sorted(thumbnails.keep(jpeg_image(label)) for label in ("Bremen", "Gloria"))

    asked = thumbnails.service.sweep()

    assert asked == 2
    request = thumbnails.asked()
    assert request.names == tuple(names)
    assert request.covers_folder == str(thumbnails.covers)
    assert [(size.label, size.pixels) for size in request.sizes] == [
        ("small", 128),
        ("medium", 512),
    ]
    assert (request.quality, request.thumbnailer) == (4, "sketcher")


def test_an_image_already_thumbnailed_or_unreadable_is_not_asked_again(
    thumbnails: Thumbnails,
) -> None:
    done, unreadable = thumbnails.keep(jpeg_image("done")), thumbnails.keep(jpeg_image("bad"))
    thumbnails.made.mkdir(parents=True)
    (thumbnails.made / f"{done}.made").touch()
    (thumbnails.made / f"{unreadable}.unreadable").touch()

    assert thumbnails.service.sweep() == 0
    assert thumbnails.active() is None


def test_one_job_asks_for_at_most_five_hundred_images(thumbnails: Thumbnails) -> None:
    for number in range(501):
        thumbnails.keep(jpeg_image(str(number)))

    assert thumbnails.service.sweep() == 500
    assert len(thumbnails.asked().names) == 500


def test_nothing_more_is_asked_while_a_job_is_active(thumbnails: Thumbnails) -> None:
    thumbnails.keep(jpeg_image("first"))
    thumbnails.service.sweep()
    thumbnails.keep(jpeg_image("second"))

    assert thumbnails.service.sweep() == 0
    assert len(thumbnails.asked().names) == 1


def test_nothing_is_asked_while_the_thumbnailer_is_off(
    units: sessionmaker[Session], clock: FakeClock, tmp_path: Path
) -> None:
    with thumbnails_over(units, clock, tmp_path / "data", plugin=False) as off:
        off.keep(jpeg_image())

        assert off.service.sweep() == 0
        assert off.active() is None


def test_nothing_is_asked_without_kept_images(thumbnails: Thumbnails) -> None:
    assert thumbnails.service.sweep() == 0


def test_the_job_puts_each_size_made_in_place_and_marks_the_image(
    thumbnails: Thumbnails,
) -> None:
    large, between = thumbnails.keep(jpeg_image("Bremen")), thumbnails.keep(png_image("small"))
    thumbnails.service.sweep()

    thumbnails.run_until_done()

    assert sorted(path.name for path in thumbnails.made.iterdir()) == sorted(
        [
            f"{large}-small",
            f"{large}-medium",
            f"{large}.made",
            f"{between}-small",
            f"{between}.made",
        ]
    )
    assert (thumbnails.made / f"{large}-medium").read_bytes().endswith(b"Bremen medium image/jpeg")


def test_an_image_the_thumbnailer_cannot_read_is_marked_and_one_that_timed_out_is_not(
    thumbnails: Thumbnails,
) -> None:
    unreadable = thumbnails.keep(jpeg_image("unreadable"))
    thumbnails.keep(jpeg_image("timed-out"))
    thumbnails.service.sweep()

    thumbnails.run_until_done()

    assert [path.name for path in thumbnails.made.iterdir()] == [f"{unreadable}.unreadable"]


def test_a_found_thumbnail_is_served_with_the_kind_its_bytes_say(thumbnails: Thumbnails) -> None:
    name = thumbnails.keep(jpeg_image("Bremen"))
    thumbnails.service.sweep()
    thumbnails.run_until_done()

    assert thumbnails.service.found(name, ThumbnailSize.SMALL) == (
        thumbnails.made / f"{name}-small",
        CoverType.JPEG,
    )


def test_a_size_not_made_is_not_found(thumbnails: Thumbnails) -> None:
    name = thumbnails.keep(png_image("small"))
    thumbnails.service.sweep()
    thumbnails.run_until_done()

    assert thumbnails.service.found(name, ThumbnailSize.MEDIUM) is None


@pytest.mark.parametrize("name", ["", "../covers/x", "A" * 64])
def test_a_name_other_than_a_cover_id_finds_nothing(thumbnails: Thumbnails, name: str) -> None:
    assert thumbnails.service.found(name, ThumbnailSize.SMALL) is None


def test_a_linked_thumbnail_is_not_found(thumbnails: Thumbnails, tmp_path: Path) -> None:
    name = cover_id(jpeg_image())
    elsewhere = tmp_path / "elsewhere.jpg"
    elsewhere.write_bytes(jpeg_image())
    thumbnails.made.mkdir(parents=True)
    (thumbnails.made / f"{name}-small").symlink_to(elsewhere)

    assert thumbnails.service.found(name, ThumbnailSize.SMALL) is None


def test_without_the_program_reconcile_waits_an_hour(
    thumbnails: Thumbnails, clock: FakeClock
) -> None:
    thumbnails.keep(jpeg_image("no-tool"))
    thumbnails.service.sweep()
    thumbnails.run_until_done()

    clock.advance(timedelta(minutes=59))
    assert thumbnails.service.sweep() == 0
    clock.advance(timedelta(minutes=2))
    assert thumbnails.service.sweep() == 1


def finished_job(thumbnails: Thumbnails) -> Job:
    """Submit a Job for one image, and return it: the runner never starts it."""
    thumbnails.keep(jpeg_image())
    thumbnails.service.sweep()
    job = thumbnails.active()
    assert job is not None
    return job


@pytest.mark.parametrize(
    "written",
    [b"GIF89a, no thumbnail", b"\xff\xd8\xff" + b"\0" * (1024 * 1024)],
    ids=["not a JPEG or PNG", "over 1 MiB"],
)
def test_a_thumbnail_written_wrong_is_dropped_and_the_image_marked_unreadable(
    thumbnails: Thumbnails, written: bytes
) -> None:
    job = finished_job(thumbnails)
    name = "f" * 64
    work = thumbnails.data / "jobs" / str(job.id)
    work.mkdir(parents=True)
    (work / f"{name}-small").write_bytes(written)
    result = MadeThumbnailsResult(
        images=(Thumbnailed(name=name, status=ThumbnailStatus.OK, made=("small",)),)
    )

    with thumbnails.units.begin() as db:
        make_thumbnails_kind(thumbnails.data / "thumbnails", thumbnails.data / "jobs").complete(
            db, job, result
        )

    assert [path.name for path in thumbnails.made.iterdir()] == [f"{name}.unreadable"]


def test_tidying_removes_the_thumbnails_and_marks_of_images_no_longer_kept(
    thumbnails: Thumbnails,
) -> None:
    kept, gone = thumbnails.keep(jpeg_image("kept")), "0" * 64
    thumbnails.made.mkdir(parents=True)
    for name in (kept, gone):
        (thumbnails.made / f"{name}-small").write_bytes(jpeg_image())
        (thumbnails.made / f"{name}.made").touch()
    (thumbnails.made / f"{gone}.unreadable").touch()

    thumbnails.service.tidy()

    assert sorted(path.name for path in thumbnails.made.iterdir()) == [
        f"{kept}-small",
        f"{kept}.made",
    ]


def test_tidying_removes_the_thumbnails_of_older_recipes(thumbnails: Thumbnails) -> None:
    older = thumbnails.data / "thumbnails" / "0"
    older.mkdir(parents=True)
    (older / f"{'0' * 64}-small").write_bytes(jpeg_image())
    thumbnails.made.mkdir(parents=True)

    thumbnails.service.tidy()

    assert [path.name for path in (thumbnails.data / "thumbnails").iterdir()] == [
        str(THUMBNAIL_RECIPE)
    ]
