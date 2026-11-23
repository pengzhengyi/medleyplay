"""The explicit search queues Offline and lends a key only to its dedicated Job process."""

from pathlib import Path
from threading import Event

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.accounts import AccountService
from medleyplay.application.events import Events
from medleyplay.application.image_links import AlbumPictured
from medleyplay.application.image_search import IMAGE_SEARCH, ImageSearchService, TavilyKeys
from medleyplay.application.job_runner import JobProcesses, JobRunner
from medleyplay.application.jobs import JobService
from medleyplay.application.plugins import PluginService
from medleyplay.domain.jobs import JobId, JobState
from medleyplay.persistence.schema import JobRow
from medleyplay.plugin_host.process import HostCommand
from tests.support.factories import NewAccountFactory
from tests.support.fakes import FakeClock, MemorySecrets, OnlineSwitch
from tests.support.hosts import TEST_PLUGINS


def _finished(events: Events, jobs: JobService) -> Event:
    done = Event()

    def on_job_change(job_id: JobId) -> None:
        if not jobs.get_job(job_id).job.state.is_active:
            done.set()

    events.listen(on_job_change)
    return done


def _test_plugins() -> JobProcesses:
    root = Path(__file__).resolve().parents[2]
    return JobProcesses(HostCommand(env={"PYTHONPATH": f"{root / 'src'}:{root}"}), TEST_PLUGINS)


@pytest.mark.parametrize(
    "forget_key", [False, True], ids=["key available", "key removed while Offline"]
)
def test_only_the_search_plugin_gets_the_key_available_when_its_job_starts(
    units: sessionmaker[Session],
    clock: FakeClock,
    tmp_path: Path,
    plugins: PluginService,
    accounts: AccountService,
    monkeypatch: pytest.MonkeyPatch,
    *,
    forget_key: bool,
) -> None:
    caller = accounts.create_first_admin(NewAccountFactory.admin()).account
    keys = TavilyKeys(MemorySecrets())
    keys.set(caller, "fixture-key")
    online = OnlineSwitch(online=False)
    monkeypatch.setattr(plugins, "plugins_for", lambda _: ("reader", "tavily"))
    kinds = {IMAGE_SEARCH.name: IMAGE_SEARCH}
    events = Events()
    runner = JobRunner(
        units,
        clock,
        kinds,
        plugins,
        tmp_path / "jobs",
        processes=_test_plugins(),
        online=online,
        tavily_key=keys.lend,
        events=events,
    )
    jobs = JobService(units, clock, kinds, runner, online=online)

    finished = _finished(events, jobs)
    search = ImageSearchService(units, plugins, jobs, keys)
    runner.start()
    try:
        search.search(caller, AlbumPictured("Help!", "The Beatles"))
        search.search(caller, AlbumPictured("help!", "the beatles"))
        queued = search.results(caller, AlbumPictured("Help!", "The Beatles"))
        assert queued.waiting
        assert queued.searching
        with units() as db:
            row = db.scalars(select(JobRow)).one()
            assert row.request == {"album": "Help!", "artist": "The Beatles", "provider": "tavily"}
        if forget_key:
            keys.remove(caller)
        online.online = True
        runner.wake()
        assert finished.wait(20)
        completed = search.results(caller, AlbumPictured("help!", "the beatles"))
        assert not completed.searching
        assert not completed.waiting
        if forget_key:
            assert jobs.list_jobs()[0].job.state is JobState.FAILED
            assert completed.failure == "Enable the Tavily plugin and set its key in Settings."
            assert completed.images == ()
        else:
            assert completed.failure is None
            assert [image.model_dump() for image in completed.images] == [
                {
                    "url": "https://label.example/cover.jpg",
                    "page": "https://label.example/releases",
                    "title": "Help!",
                }
            ]
        assert not search.results(caller, AlbumPictured("", "The Beatles")).images
    finally:
        runner.stop()
