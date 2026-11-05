"""The test plugin `reader` answering for the enrichers, with real enrich Jobs and services."""

import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path

from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.ai import AiService
from medleyplay.application.catalog import CatalogService
from medleyplay.application.covers import COVERS_FOLDER, CoverService
from medleyplay.application.details import DetailsService
from medleyplay.application.enrichment import EnrichKind, EnrichmentService, enrich_track_kind
from medleyplay.application.job_runner import JobProcesses, JobRunner
from medleyplay.application.jobs import AnyJobKind, JobService
from medleyplay.application.plugins import PluginService
from medleyplay.application.proxies import ProxyService
from medleyplay.domain.catalog import SourceKey, TrackDetails, TrackId
from medleyplay.domain.details import Origin
from medleyplay.domain.enrichers import AI_DETAILS, BILIBILI_DETAILS
from medleyplay.domain.jobs import JobId, JobState, JobView
from medleyplay.domain.video_text import Chapter, VideoText
from tests.support.factories import SourceKeyFactory
from tests.support.fakes import FakeClock, MemorySecrets, OnlineSwitch
from tests.support.hosts import TEST_COMMAND, TEST_PLUGINS, started_plugins

WAIT: float = 20
SETTLE = 0.6
"""Long enough for the runner, which polls every tenth of a second, to have looked."""
PAUSE = BILIBILI_DETAILS.spacing
"""The time the enricher waits between two calls."""
AI_PAUSE = AI_DETAILS.spacing
"""The time the AI enricher waits between two calls."""


@dataclass(frozen=True)
class Enriching:
    """The services around a running `reader` plugin, and the folders they keep files in."""

    enrichment: EnrichmentService
    kind: EnrichKind
    jobs: JobService
    runner: JobRunner
    plugins: PluginService
    catalog: CatalogService
    details: DetailsService
    covers: CoverService
    proxies: ProxyService
    ai: AiService
    secrets: MemorySecrets
    units: sessionmaker[Session]
    clock: FakeClock
    data_dir: Path
    online: OnlineSwitch

    def wait_for(
        self, job_id: JobId, *states: JobState, until: Callable[[JobView], bool] | None = None
    ) -> JobView:
        """Wait until the Job is in one of `states`, and `until` holds, then return it."""
        ends = time.monotonic() + WAIT
        while time.monotonic() < ends:
            view = self.jobs.get_job(job_id)
            if view.job.state in states and (until is None or until(view)):
                return view
            time.sleep(0.05)
        message = f"Job {job_id} is {self.jobs.get_job(job_id).job.state}, not in {states}."
        raise AssertionError(message)

    def pause_passes(self) -> None:
        """Move the clock past the enricher's pause, so its next Job may start."""
        self.clock.advance(PAUSE)
        self.runner.wake()

    def finish_every_job(self) -> None:
        """Pass the enricher's pause again and again until no Job is left to run."""
        ends = time.monotonic() + WAIT
        while time.monotonic() < ends:
            if not any(view.job.state.is_active for view in self.jobs.list_jobs()):
                return
            self.pause_passes()
            time.sleep(0.1)
        message = "Jobs are still active."
        raise AssertionError(message)

    def add_site_track(self, video: str, part: int = 1) -> TrackId:
        """Add one part of a Bilibili video as a Track, as adding its link does."""
        return self.catalog.add_track(
            SourceKeyFactory.bilibili(video, part), TrackDetails(title=f"{video} p{part}")
        )

    def add_song(
        self,
        title: str,
        artist: str = "Radiohead",
        album: str = "",
        *,
        origin: Origin = Origin.FILES,
    ) -> TrackId:
        """Add a Library file `<title>.m4a` whose tags say `title`, `artist`, and `album`.

        The details are recorded as `origin`'s, which are the file's tags unless changed.
        """
        key = SourceKey("library", f"1/Music/{title}.m4a")
        details = TrackDetails(title=title, artist=artist, album=album, duration_ms=299_000)
        return self.catalog.add_track(key, details, origin=origin)

    def add_track_with_text(
        self,
        title: str,
        description: str = "",
        chapters: tuple[Chapter, ...] = (),
        *,
        name: str | None = None,
    ) -> TrackId:
        """Add a Library file whose video text has the title `title`, as the household pasted it.

        The title says how the test plugin `reader` answers the AI.
        """
        track_id = self.add_file_track(name or f"{title}.m4a")
        self.details.read_video_text(track_id, VideoText(title, description, chapters))
        return track_id

    def add_file_track(self, name: str, library: int = 1) -> TrackId:
        """Add a Library file called `name` as a Track, as a scan does."""
        key = SourceKey("library", f"{library}/Music/{name}")
        return self.catalog.add_track(key, TrackDetails(title=name.rpartition(".")[0]))


@contextmanager
def running_enrichment(
    units: sessionmaker[Session], clock: FakeClock, data_dir: Path
) -> Iterator[Enriching]:
    """Run `reader`, enrich Jobs, and the services around them over `data_dir`.

    The services follow `Enriching.online`, which a test turns Offline. The enricher
    pauses `PAUSE` between calls, which a test passes by moving the clock.
    """
    online = OnlineSwitch()
    jobs_dir = data_dir / "jobs"
    kind = enrich_track_kind(data_dir / COVERS_FOLDER, clock)
    kinds: dict[str, AnyJobKind] = {kind.name: kind}
    with started_plugins(units, clock, "reader") as plugins:
        secrets = MemorySecrets()
        proxies = ProxyService(units, clock, secrets)
        ai = AiService(units, clock, secrets)
        runner = JobRunner(
            units,
            clock,
            kinds,
            plugins,
            jobs_dir,
            processes=JobProcesses(TEST_COMMAND, TEST_PLUGINS),
            poll=timedelta(seconds=0.1),
            proxies=proxies,
            ai=ai,
            online=online,
        )
        jobs = JobService(units, clock, kinds, runner, online=online)
        jobs.start()
        try:
            yield Enriching(
                enrichment=EnrichmentService(units, clock, plugins, jobs, kind),
                kind=kind,
                jobs=jobs,
                runner=runner,
                plugins=plugins,
                catalog=CatalogService(units, clock, online=online),
                details=DetailsService(units, clock),
                covers=CoverService(units, clock, data_dir / COVERS_FOLDER),
                proxies=proxies,
                ai=ai,
                secrets=secrets,
                units=units,
                clock=clock,
                data_dir=data_dir,
                online=online,
            )
        finally:
            jobs.stop()
