"""Cached answers: built once per revision and key, shared by concurrent requests."""

import gzip
import threading
from collections.abc import Callable

import pytest
from pydantic import TypeAdapter

from medleyplay.persistence.revision import DatabaseRevision
from medleyplay.web.cached import CachedAnswers, HeavyReadReenteredError, heavy_read

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

    first = answers.get(("songs",), builds, NUMBERS)
    again = answers.get(("songs",), builds, NUMBERS)

    assert builds.count == 1
    assert again == first
    assert NUMBERS.validate_json(first.plain) == [1, 2, 3, 1]
    assert gzip.decompress(first.gzipped) == first.plain


def test_a_new_revision_builds_the_answer_anew_and_replaces_the_older_one() -> None:
    revision = DatabaseRevision()
    answers, builds = CachedAnswers(revision), _Builds()
    older = answers.get(("songs",), builds, NUMBERS)

    revision.bump()
    newer = answers.get(("songs",), builds, NUMBERS)
    again = answers.get(("songs",), builds, NUMBERS)

    assert builds.count == 2
    assert NUMBERS.validate_json(newer.plain) == [1, 2, 3, 2]
    assert newer.etag != older.etag
    assert again == newer


def test_each_key_has_an_answer_of_its_own() -> None:
    answers, builds = CachedAnswers(DatabaseRevision()), _Builds()

    alice_online = answers.get(("songs", 1, True), builds, NUMBERS)
    bob_online = answers.get(("songs", 2, True), builds, NUMBERS)
    alice_offline = answers.get(("songs", 1, False), builds, NUMBERS)

    assert builds.count == 3
    assert len({alice_online.etag, bob_online.etag, alice_offline.etag}) == 3


def test_the_same_key_and_revision_on_another_server_has_another_etag() -> None:
    one, another = CachedAnswers(DatabaseRevision()), CachedAnswers(DatabaseRevision())

    assert one.etag(("songs",), 0) != another.etag(("songs",), 0)
    assert one.etag(("songs",), 0) == one.etag(("songs",), 0)


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

    builder, built = _run(lambda: answers.get(("songs",), slow, NUMBERS))
    assert building.wait(WAIT)
    waiter, waited = _run(lambda: answers.get(("songs",), slow, NUMBERS))
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
        answers.get(("songs",), broken, NUMBERS)
    answer = answers.get(("songs",), builds, NUMBERS)

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

    builder, built = _run(lambda: answers.get(("songs",), broken, NUMBERS))
    assert building.wait(WAIT)
    waiter, waited = _run(lambda: answers.get(("songs",), broken, NUMBERS))
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
        answers.get(("songs",), broken, NUMBERS)

    assert _taken_within_a_moment()


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
