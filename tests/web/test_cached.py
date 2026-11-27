"""Cached answers, built once per revision and key; heavy reads, one at a time."""

import gzip
import re
import threading
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import timedelta
from typing import Final

import pytest
from fastapi.testclient import TestClient
from pydantic import TypeAdapter
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.accounts import AccountService
from medleyplay.application.catalog import CatalogService
from medleyplay.domain.catalog import TrackId
from medleyplay.domain.lyrics import MAX_LYRICS, LyricsOrigin
from medleyplay.persistence.revision import DatabaseRevision
from medleyplay.persistence.schema import DeviceRow, SessionRow, SourceRow, TrackLyricsRow
from medleyplay.web.cached import (
    AnswerKey,
    CachedAnswer,
    CachedAnswers,
    HeavyReadReenteredError,
    heavy_read,
)
from medleyplay.web.deps import Services
from tests.support.api import set_up_as_alice
from tests.support.factories import NewAccountFactory, SourceKeyFactory, TrackDetailsFactory
from tests.support.fakes import FakeClock

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


HEAVY_PATHS: Final = [
    "/api/tracks",
    "/api/artist-names",
    "/api/shared-names",
    "/api/artist-photos/missing",
]
LIGHT_PATHS: Final = ["/api/names-to-tidy", "/api/artist-splits", "/api/split-offers"]
CACHED_PATHS: Final = HEAVY_PATHS + LIGHT_PATHS
BOOKKEEPING_TABLES: Final = {SessionRow.__tablename__, DeviceRow.__tablename__}
_TABLE = re.compile(r'\b(?:FROM|JOIN|INTO|UPDATE)\s+"?(\w+)', re.IGNORECASE)
_WRITE = re.compile(r"^\s*(?:INSERT|UPDATE|DELETE)\b", re.IGNORECASE)


@contextmanager
def _statements(units: sessionmaker[Session]) -> Iterator[list[str]]:
    """Collect every SQL statement the database runs inside the block."""
    engine: Engine = units.kw["bind"]
    ran: list[str] = []

    def note(*args: object) -> None:
        ran.append(str(args[2]))

    event.listen(engine, "before_cursor_execute", note)
    try:
        yield ran
    finally:
        event.remove(engine, "before_cursor_execute", note)


def _tables(statements: list[str]) -> set[str]:
    return {table for statement in statements for table in _TABLE.findall(statement)}


def test_a_signed_in_request_a_minute_later_leaves_the_revision_alone(
    client: TestClient, services: Services, clock: FakeClock
) -> None:
    set_up_as_alice(client)
    client.get("/api/tracks")
    clock.advance(timedelta(minutes=2))
    before = services.revision.value

    response = client.get("/api/tracks")

    assert response.status_code == 200
    assert services.revision.value == before


def test_a_signed_in_request_a_minute_later_writes_only_bookkeeping(
    client: TestClient, units: sessionmaker[Session], clock: FakeClock
) -> None:
    set_up_as_alice(client)
    client.get("/api/tracks")
    clock.advance(timedelta(minutes=2))

    with _statements(units) as ran:
        client.get("/api/tracks", headers={"If-None-Match": "*"})

    written = _tables([statement for statement in ran if _WRITE.match(statement)])
    assert written
    assert written <= BOOKKEEPING_TABLES


def test_a_cold_song_list_uses_fewer_source_reads_without_losing_video_links(
    client: TestClient, units: sessionmaker[Session], catalog: CatalogService
) -> None:
    set_up_as_alice(client)
    local = catalog.add_track(SourceKeyFactory.library_file(), TrackDetailsFactory.song("Intro"))
    site = catalog.add_track(SourceKeyFactory.bilibili(part=2), TrackDetailsFactory.song("Encore"))

    with _statements(units) as ran:
        response = client.get("/api/tracks")

    assert response.status_code == 200, response.text
    tracks = {track["id"]: track for track in response.json()}
    assert tracks[local]["video"] == "https://www.bilibili.com/video/BV1dm4y1s7ak"
    assert tracks[site]["video"] == "https://www.bilibili.com/video/BV1Xx41117Tz?p=2"
    source_reads = [
        statement for statement in ran if SourceRow.__tablename__ in _tables([statement])
    ]
    assert len(source_reads) <= 3, source_reads


def test_catalog_lyrics_reads_are_bounded_batches_of_selected_sources(
    units: sessionmaker[Session],
    catalog: CatalogService,
    accounts: AccountService,
    clock: FakeClock,
) -> None:
    alice = accounts.create_first_admin(NewAccountFactory.admin()).account
    with units.begin() as db:
        for index in range(501):
            source = catalog.insert_in(
                db,
                SourceKeyFactory.library_file(f"3/song-{index}.m4a"),
                TrackDetailsFactory.song(f"Song {index}"),
            )
            db.add_all(
                [
                    TrackLyricsRow(
                        track_id=source.track_id,
                        origin=origin,
                        text=text,
                        found_at=clock.now,
                    )
                    for origin, text in (
                        (LyricsOrigin.HOUSEHOLD, "Sing with me"),
                        (LyricsOrigin.LRCLIB, "x" * (MAX_LYRICS + 1)),
                    )
                ]
            )

    with _statements(units) as ran:
        tracks = catalog.list_tracks(alice.id)

    assert len(tracks) == 501
    assert all(track.has_lyrics for track in tracks)
    lyrics_reads = [statement for statement in ran if "track_lyrics" in _tables([statement])]
    assert len(lyrics_reads) == 2

    with _statements(units) as ran:
        fetched = catalog.get_track(alice.id, tracks[-1].id)

    assert fetched.has_lyrics
    lyrics_reads = [statement for statement in ran if "track_lyrics" in _tables([statement])]
    assert len(lyrics_reads) == 1


def test_an_individual_track_does_not_parse_another_tracks_lyrics(
    units: sessionmaker[Session],
    catalog: CatalogService,
    accounts: AccountService,
    clock: FakeClock,
) -> None:
    alice = accounts.create_first_admin(NewAccountFactory.admin()).account
    track_ids: list[TrackId] = []
    with units.begin() as db:
        for index, text in enumerate(("Sing with me", "x" * (MAX_LYRICS + 1))):
            source = catalog.insert_in(
                db,
                SourceKeyFactory.library_file(f"3/song-{index}.m4a"),
                TrackDetailsFactory.song(f"Song {index}"),
            )
            track_ids.append(TrackId(source.track_id))
            db.add(
                TrackLyricsRow(
                    track_id=source.track_id,
                    origin=LyricsOrigin.HOUSEHOLD,
                    text=text,
                    found_at=clock.now,
                )
            )

    assert catalog.get_track(alice.id, track_ids[0]).has_lyrics


@pytest.mark.parametrize("path", CACHED_PATHS)
def test_no_cached_answer_is_built_from_a_table_bookkeeping_writes(
    client: TestClient,
    services: Services,
    units: sessionmaker[Session],
    catalog: CatalogService,
    monkeypatch: pytest.MonkeyPatch,
    path: str,
) -> None:
    set_up_as_alice(client)
    catalog.add_track(SourceKeyFactory.bilibili(), TrackDetailsFactory.song("Intro"))
    built: list[str] = []
    get = services.answers.get

    def recording_get[T](
        key: AnswerKey, build: Callable[[], T], adapter: TypeAdapter[T], *, heavy: bool
    ) -> CachedAnswer:
        def recorded() -> T:
            with _statements(units) as ran:
                answer = build()
            built.extend(ran)
            return answer

        return get(key, recorded, adapter, heavy=heavy)

    monkeypatch.setattr(services.answers, "get", recording_get)

    response = client.get(path, headers={"If-None-Match": ""})

    assert response.status_code == 200, response.text
    assert built
    assert not _tables(built) & BOOKKEEPING_TABLES


@pytest.mark.parametrize("path", CACHED_PATHS)
def test_a_cached_read_answers_304_when_asked_with_the_etag_it_sent(
    client: TestClient, catalog: CatalogService, path: str
) -> None:
    set_up_as_alice(client)
    catalog.add_track(SourceKeyFactory.bilibili(), TrackDetailsFactory.song("Intro"))
    first = client.get(path)

    again = client.get(path, headers={"If-None-Match": first.headers["etag"]})

    assert first.status_code == 200, first.text
    assert first.headers["cache-control"] == "private, no-cache"
    assert again.status_code == 304
    assert again.content == b""


@pytest.mark.parametrize("path", LIGHT_PATHS)
def test_a_light_cached_read_never_waits_for_a_heavy_read(client: TestClient, path: str) -> None:
    set_up_as_alice(client)
    inside, release = threading.Event(), threading.Event()

    def hold() -> None:
        with heavy_read():
            inside.set()
            assert release.wait(WAIT)

    holder, _ = _run(hold)
    assert inside.wait(WAIT)
    reader, read = _run(lambda: client.get(path, headers={"If-None-Match": ""}))
    reader.join(WAIT)
    release.set()
    holder.join(WAIT)

    assert len(read) == 1
    assert getattr(read[0], "status_code", None) == 200


@pytest.mark.parametrize("path", CACHED_PATHS)
def test_a_heavy_read_writes_nothing_so_it_never_waits_on_a_write_while_holding_the_lock(
    client: TestClient, services: Services, catalog: CatalogService, path: str
) -> None:
    set_up_as_alice(client)
    catalog.add_track(SourceKeyFactory.bilibili(), TrackDetailsFactory.song("Intro"))
    before = services.revision.value

    response = client.get(path, headers={"If-None-Match": ""})

    assert response.status_code == 200, response.text
    assert services.revision.value == before
