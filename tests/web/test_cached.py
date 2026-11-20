"""Cached answers, built once per revision and key; heavy reads, one at a time."""

import gzip
import threading
from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient
from pydantic import TypeAdapter

from medleyplay.application.catalog import CatalogService
from medleyplay.persistence.revision import DatabaseRevision
from medleyplay.web.cached import CachedAnswers, HeavyReadReenteredError, heavy_read
from medleyplay.web.deps import Services
from tests.support.api import set_up_as_alice
from tests.support.factories import SourceKeyFactory, TrackDetailsFactory

NUMBERS = TypeAdapter(list[int])
WAIT = 10.0


class _Builds:
    """A build that counts how often it ran, answering `[1, 2, 3]` and then a number more."""

    def __init__(self) -> None:
        self.count = 0

    def __call__(self) -> list[int]:
        self.count += 1
        return [1, 2, 3, self.count]


def _run(task: Callable[[], object]) -> tuple[threading.Thread, list[object]]:
    """Start `task` in a thread; the list gets what it returned or raised."""
    outcome: list[object] = []

    def run() -> None:
        try:
            outcome.append(task())
        except Exception as error:  # noqa: BLE001 -- the test reads what it raised
            outcome.append(error)

    thread = threading.Thread(target=run)
    thread.start()
    return thread, outcome


def test_a_miss_builds_the_answer_and_a_hit_sends_it_without_building() -> None:
    answers, builds = CachedAnswers(DatabaseRevision()), _Builds()

    first = answers.get(("songs",), builds, NUMBERS, heavy=True)
    again = answers.get(("songs",), builds, NUMBERS, heavy=True)

    assert builds.count == 1
    assert again == first
    assert NUMBERS.validate_json(first.plain) == [1, 2, 3, 1]
    assert gzip.decompress(first.gzipped) == first.plain


def test_a_new_revision_builds_the_answer_anew_and_replaces_the_older_one() -> None:
    revision = DatabaseRevision()
    answers, builds = CachedAnswers(revision), _Builds()
    older = answers.get(("songs",), builds, NUMBERS, heavy=True)

    revision.bump()
    newer = answers.get(("songs",), builds, NUMBERS, heavy=True)
    again = answers.get(("songs",), builds, NUMBERS, heavy=True)

    assert builds.count == 2
    assert NUMBERS.validate_json(newer.plain) == [1, 2, 3, 2]
    assert newer.etag != older.etag
    assert again == newer


def test_a_rebuild_that_gives_the_same_bytes_keeps_the_etag() -> None:
    revision = DatabaseRevision()
    answers, builds = CachedAnswers(revision), _Builds()
    older = answers.get(("songs",), _same, NUMBERS, heavy=True)

    revision.bump()
    newer = answers.get(("songs",), lambda: (builds(), [1, 2, 3])[1], NUMBERS, heavy=True)

    assert builds.count == 1
    assert newer.revision > older.revision
    assert newer.etag == older.etag


def test_each_key_has_an_answer_and_an_etag_of_its_own_even_with_the_same_bytes() -> None:
    answers = CachedAnswers(DatabaseRevision())

    alice_online = answers.get(("songs", 1, True), _same, NUMBERS, heavy=True)
    bob_online = answers.get(("songs", 2, True), _same, NUMBERS, heavy=True)
    alice_offline = answers.get(("songs", 1, False), _same, NUMBERS, heavy=True)

    assert alice_online.plain == bob_online.plain == alice_offline.plain
    assert len({alice_online.etag, bob_online.etag, alice_offline.etag}) == 3


def test_another_server_gives_the_same_key_and_bytes_the_same_etag() -> None:
    one, another = CachedAnswers(DatabaseRevision()), CachedAnswers(DatabaseRevision())

    first = one.get(("songs",), _same, NUMBERS, heavy=True)
    after_a_restart = another.get(("songs",), _same, NUMBERS, heavy=True)

    assert after_a_restart.etag == first.etag


def _same() -> list[int]:
    """A build that answers `[1, 2, 3]` every time."""
    return [1, 2, 3]


def test_a_request_arriving_while_its_answer_is_built_waits_for_that_build() -> None:
    answers, building, release = (
        CachedAnswers(DatabaseRevision()),
        threading.Event(),
        threading.Event(),
    )
    builds = _Builds()

    def slow() -> list[int]:
        building.set()
        assert release.wait(WAIT)
        return builds()

    builder, built = _run(lambda: answers.get(("songs",), slow, NUMBERS, heavy=True))
    assert building.wait(WAIT)
    waiter, waited = _run(lambda: answers.get(("songs",), slow, NUMBERS, heavy=True))
    release.set()
    builder.join(WAIT)
    waiter.join(WAIT)

    assert builds.count == 1
    assert waited == built


def test_a_build_that_raises_keeps_nothing_and_its_error_reaches_the_request() -> None:
    answers, builds = CachedAnswers(DatabaseRevision()), _Builds()

    def broken() -> list[int]:
        message = "the database said no"
        raise RuntimeError(message)

    with pytest.raises(RuntimeError, match="the database said no"):
        answers.get(("songs",), broken, NUMBERS, heavy=True)
    answer = answers.get(("songs",), builds, NUMBERS, heavy=True)

    assert builds.count == 1
    assert NUMBERS.validate_json(answer.plain) == [1, 2, 3, 1]


def test_a_request_waiting_on_a_build_that_raises_gets_the_same_error() -> None:
    answers, building, release = (
        CachedAnswers(DatabaseRevision()),
        threading.Event(),
        threading.Event(),
    )
    failure = RuntimeError("the database said no")

    def broken() -> list[int]:
        building.set()
        assert release.wait(WAIT)
        raise failure

    builder, built = _run(lambda: answers.get(("songs",), broken, NUMBERS, heavy=True))
    assert building.wait(WAIT)
    waiter, waited = _run(lambda: answers.get(("songs",), broken, NUMBERS, heavy=True))
    release.set()
    builder.join(WAIT)
    waiter.join(WAIT)

    assert built == [failure]
    assert len(waited) == 1
    assert isinstance(waited[0], RuntimeError)


def test_a_build_that_raises_lets_go_of_the_heavy_read_lock() -> None:
    answers = CachedAnswers(DatabaseRevision())

    def broken() -> list[int]:
        raise RuntimeError

    with pytest.raises(RuntimeError):
        answers.get(("songs",), broken, NUMBERS, heavy=True)

    assert _taken_within_a_moment()


def test_a_light_build_never_waits_for_a_heavy_read() -> None:
    answers = CachedAnswers(DatabaseRevision())
    inside, release = threading.Event(), threading.Event()

    def hold() -> None:
        with heavy_read():
            inside.set()
            assert release.wait(WAIT)

    holder, _ = _run(hold)
    assert inside.wait(WAIT)
    reader, read = _run(lambda: answers.get(("offers",), _same, NUMBERS, heavy=False))
    reader.join(WAIT)
    release.set()
    holder.join(WAIT)

    assert len(read) == 1
    assert not isinstance(read[0], Exception)


def test_a_heavy_build_waits_for_the_heavy_read_under_way() -> None:
    answers = CachedAnswers(DatabaseRevision())
    inside, release = threading.Event(), threading.Event()

    def hold() -> None:
        with heavy_read():
            inside.set()
            assert release.wait(WAIT)

    holder, _ = _run(hold)
    assert inside.wait(WAIT)
    reader, read = _run(lambda: answers.get(("songs",), _same, NUMBERS, heavy=True))
    reader.join(0.2)
    built_early = bool(read)
    release.set()
    holder.join(WAIT)
    reader.join(WAIT)

    assert not built_early
    assert len(read) == 1


def test_a_heavy_read_waits_for_the_one_under_way() -> None:
    inside, release, second_inside = threading.Event(), threading.Event(), threading.Event()

    def first() -> None:
        with heavy_read():
            inside.set()
            assert release.wait(WAIT)

    def second() -> None:
        with heavy_read():
            second_inside.set()

    one, _ = _run(first)
    assert inside.wait(WAIT)
    two, _ = _run(second)
    entered_early = second_inside.wait(0.2)
    release.set()
    one.join(WAIT)
    two.join(WAIT)

    assert not entered_early
    assert second_inside.is_set()


def test_a_heavy_read_started_inside_another_raises_at_once() -> None:
    with heavy_read(), pytest.raises(HeavyReadReenteredError):  # noqa: SIM117 -- nested on purpose
        with heavy_read():
            pass

    assert _taken_within_a_moment()


def _taken_within_a_moment() -> bool:
    """Return whether another thread takes the heavy-read lock at once."""
    taken = threading.Event()

    def take() -> None:
        with heavy_read():
            taken.set()

    thread, _ = _run(take)
    thread.join(WAIT)
    return taken.is_set()


@pytest.mark.parametrize(
    "path",
    [
        "/api/tracks",
        "/api/artist-names",
        "/api/artist-photos/missing",
        "/api/shared-names",
    ],
)
def test_a_heavy_read_writes_nothing_so_it_never_waits_on_a_write_while_holding_the_lock(
    client: TestClient, services: Services, catalog: CatalogService, path: str
) -> None:
    set_up_as_alice(client)
    catalog.add_track(SourceKeyFactory.bilibili(), TrackDetailsFactory.song("Intro"))
    before = services.revision.value

    response = client.get(path, headers={"If-None-Match": ""})

    assert response.status_code == 200, response.text
    assert services.revision.value == before
