"""Remote play: a host page plays for its account, and the account's other pages control it."""

from datetime import timedelta

import pytest

from medleyplay.application.remote import (
    MAX_WAITING_COMMANDS,
    CommandsWaiting,
    PageId,
    RemoteEvent,
    RemoteService,
    ReportChanged,
)
from medleyplay.domain.accounts import AccountId
from medleyplay.domain.errors import BusyError, ConflictError
from tests.support.fakes import FakeClock

ALICE = AccountId(1)
BOB = AccountId(2)
HOST_PAGE = PageId("host-page-1")
OTHER_HOST_PAGE = PageId("host-page-2")
PLAYING = {"status": "playing", "position": 12.5}
PAUSED = {"status": "paused", "position": 3.0}


@pytest.fixture
def remote(clock: FakeClock) -> RemoteService:
    return RemoteService(clock)


@pytest.fixture
def heard(remote: RemoteService) -> list[RemoteEvent]:
    """Every event the service tells, in order."""
    events: list[RemoteEvent] = []
    remote.listen(events.append)
    return events


def speaker_playing(remote: RemoteService, page: PageId = HOST_PAGE) -> RemoteService:
    """Alice's host `page`, its event stream open, reported it plays."""
    remote.open(ALICE, page)
    remote.report(ALICE, page, PLAYING, playing=True, queued=True)
    return remote


class TestBecomingTheSpeaker:
    def test_an_account_has_no_speaker_until_a_page_reports(self, remote: RemoteService) -> None:
        assert remote.report_of(ALICE) is None

    def test_a_page_playing_becomes_the_speaker_and_its_report_is_heard_with_its_age(
        self, remote: RemoteService, clock: FakeClock
    ) -> None:
        speaker_playing(remote)
        clock.advance(timedelta(seconds=3))

        report = remote.report_of(ALICE)

        assert report is not None
        assert (report.page, report.state, report.age) == (
            HOST_PAGE,
            PLAYING,
            timedelta(seconds=3),
        )

    def test_a_page_with_a_paused_queue_becomes_the_speaker_when_there_is_none(
        self, remote: RemoteService
    ) -> None:
        remote.open(ALICE, HOST_PAGE)

        became = remote.report(ALICE, HOST_PAGE, PAUSED, playing=False, queued=True)

        assert became
        assert remote.report_of(ALICE) is not None

    def test_a_page_with_nothing_queued_never_becomes_the_speaker(
        self, remote: RemoteService
    ) -> None:
        remote.open(ALICE, HOST_PAGE)

        became = remote.report(ALICE, HOST_PAGE, PAUSED, playing=False, queued=False)

        assert not became
        assert remote.report_of(ALICE) is None

    def test_a_paused_page_leaves_another_speaker_in_place(self, remote: RemoteService) -> None:
        speaker_playing(remote)
        remote.open(ALICE, OTHER_HOST_PAGE)

        became = remote.report(ALICE, OTHER_HOST_PAGE, PAUSED, playing=False, queued=True)

        assert not became
        report = remote.report_of(ALICE)
        assert report is not None
        assert report.page == HOST_PAGE

    def test_a_page_that_starts_playing_takes_over_as_the_speaker(
        self, remote: RemoteService
    ) -> None:
        speaker_playing(remote)

        speaker_playing(remote, OTHER_HOST_PAGE)

        report = remote.report_of(ALICE)
        assert report is not None
        assert report.page == OTHER_HOST_PAGE

    def test_a_page_with_no_event_stream_never_becomes_the_speaker(
        self, remote: RemoteService
    ) -> None:
        became = remote.report(ALICE, HOST_PAGE, PLAYING, playing=True, queued=True)

        assert not became
        assert remote.report_of(ALICE) is None

    def test_each_account_has_its_own_speaker(self, remote: RemoteService) -> None:
        speaker_playing(remote)

        assert remote.report_of(BOB) is None

    def test_a_report_is_told(self, remote: RemoteService, heard: list[RemoteEvent]) -> None:
        speaker_playing(remote)

        assert heard == [ReportChanged(ALICE)]


class TestTheSpeakerGoing:
    def test_the_speaker_is_forgotten_when_its_stream_ends(
        self, remote: RemoteService, heard: list[RemoteEvent]
    ) -> None:
        speaker_playing(remote)

        remote.close(ALICE, HOST_PAGE)

        assert remote.report_of(ALICE) is None
        assert heard == [ReportChanged(ALICE)] * 2

    def test_a_stream_reconnecting_keeps_the_speaker(self, remote: RemoteService) -> None:
        speaker_playing(remote)
        remote.open(ALICE, HOST_PAGE)

        remote.close(ALICE, HOST_PAGE)

        assert remote.report_of(ALICE) is not None

    def test_another_page_going_keeps_the_speaker(self, remote: RemoteService) -> None:
        speaker_playing(remote)
        remote.open(ALICE, OTHER_HOST_PAGE)

        remote.close(ALICE, OTHER_HOST_PAGE)

        assert remote.report_of(ALICE) is not None


class TestCommands:
    def test_a_command_waits_for_the_speaker_in_order(self, remote: RemoteService) -> None:
        speaker_playing(remote)

        remote.command(ALICE, {"kind": "pause"})
        remote.command(ALICE, {"kind": "next"})

        assert remote.take_commands(ALICE, HOST_PAGE) == [{"kind": "pause"}, {"kind": "next"}]
        assert remote.take_commands(ALICE, HOST_PAGE) == []

    def test_a_command_is_told_to_the_speaker_page(
        self, remote: RemoteService, heard: list[RemoteEvent]
    ) -> None:
        speaker_playing(remote)
        heard.clear()

        remote.command(ALICE, {"kind": "toggle"})

        assert heard == [CommandsWaiting(ALICE, HOST_PAGE)]

    def test_only_the_speaker_page_takes_its_commands(self, remote: RemoteService) -> None:
        speaker_playing(remote)
        remote.command(ALICE, {"kind": "toggle"})

        assert remote.take_commands(ALICE, OTHER_HOST_PAGE) == []
        assert remote.take_commands(ALICE, HOST_PAGE) == [{"kind": "toggle"}]

    def test_a_command_with_no_speaker_conflicts(self, remote: RemoteService) -> None:
        with pytest.raises(ConflictError):
            remote.command(ALICE, {"kind": "toggle"})

    def test_a_command_past_a_full_line_is_refused_and_the_speaker_stays(
        self, remote: RemoteService
    ) -> None:
        speaker_playing(remote)
        for _ in range(MAX_WAITING_COMMANDS):
            remote.command(ALICE, {"kind": "toggle"})

        with pytest.raises(BusyError):
            remote.command(ALICE, {"kind": "toggle"})

        assert remote.report_of(ALICE) is not None
        assert len(remote.take_commands(ALICE, HOST_PAGE)) == MAX_WAITING_COMMANDS

    def test_a_new_speaker_does_not_take_the_last_one_commands(self, remote: RemoteService) -> None:
        speaker_playing(remote)
        remote.command(ALICE, {"kind": "toggle"})

        speaker_playing(remote, OTHER_HOST_PAGE)

        assert remote.take_commands(ALICE, OTHER_HOST_PAGE) == []
