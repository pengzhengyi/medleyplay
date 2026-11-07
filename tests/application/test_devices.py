"""The device service: asking, answering, admitting, and the household's choice."""

import itertools
from collections.abc import Iterator
from datetime import timedelta

import pytest
from sqlalchemy import select, update
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.accounts import SESSION_IDLE_TIMEOUT, AccountService
from medleyplay.application.devices import (
    MAX_WAITING,
    MAX_WAITING_FROM_ONE_ADDRESS,
    SEEN_RESOLUTION,
    TURNED_AWAY_FOR,
    WAIT_FOR,
    Asked,
    DeviceService,
    Presence,
    Visit,
)
from medleyplay.domain.accounts import Account
from medleyplay.domain.devices import Admission, DeviceId, Verdict
from medleyplay.domain.errors import ConflictError, ForbiddenError, NotFoundError
from medleyplay.persistence.schema import DeviceRow, SessionRow
from tests.support.factories import NewAccountFactory
from tests.support.fakes import FakeClock

SAFARI_ON_IPHONE = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15"
    " (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1"
)
HOST = Visit(token=None, address="127.0.0.1", host=True)


def phone(token: str | None = None, address: str = "192.168.1.23") -> Visit:
    """A request from a phone on the LAN, carrying the device cookie `token` if it has one."""
    return Visit(token=token, address=address, host=False)


def _numbered(prefix: str) -> Iterator[str]:
    return (f"{prefix}{n}" for n in itertools.count(1))


@pytest.fixture
def devices(
    units: sessionmaker[Session], clock: FakeClock, accounts: AccountService
) -> DeviceService:
    """The service, giving tokens `token1`, `token2`, …, codes `0001`, …, and ids `device1`, …."""
    codes = (f"{n:04d}" for n in itertools.count(1))
    return DeviceService(
        units,
        clock,
        accounts,
        new_token=_numbered("token").__next__,
        new_code=codes.__next__,
        new_id=_numbered("device").__next__,
    )


@pytest.fixture
def alice(accounts: AccountService) -> Account:
    """Alice, the household's admin, set up on the host."""
    return accounts.create_first_admin(NewAccountFactory.admin()).account


def asked_from_phone(devices: DeviceService, visit: Visit | None = None) -> Asked:
    return devices.ask(visit or phone(), SAFARI_ON_IPHONE, session_token=None)


def allowed_phone(devices: DeviceService, alice: Account, address: str = "192.168.1.23") -> Asked:
    """A phone that asked and that Alice allowed; its cookie holds the returned token."""
    asked = asked_from_phone(devices, phone(address=address))
    waiting = devices.devices(alice).waiting
    devices.allow(alice, waiting[-1].id)
    return asked


class TestAsking:
    def test_the_host_never_asks(self, devices: DeviceService, alice: Account) -> None:
        del alice  # set up
        asked = devices.ask(HOST, SAFARI_ON_IPHONE, session_token=None)

        assert (asked.presence, asked.token) == (Presence.HOST, None)

    def test_any_device_is_admitted_unrecorded_before_the_first_account(
        self, devices: DeviceService
    ) -> None:
        asked = asked_from_phone(devices)

        assert (asked.presence, asked.token) == (Presence.ADMITTED, None)

    def test_a_new_device_waits_with_a_code_and_its_label(
        self, devices: DeviceService, alice: Account
    ) -> None:
        asked = asked_from_phone(devices)

        assert (asked.presence, asked.code, asked.label, asked.token) == (
            Presence.WAITING,
            "0001",
            "Safari on iPhone",
            "token1",
        )
        assert [(w.label, w.address, w.code) for w in devices.devices(alice).waiting] == [
            ("Safari on iPhone", "192.168.1.23", "0001")
        ]

    def test_a_waiting_device_asking_again_keeps_its_code_and_token(
        self, devices: DeviceService, alice: Account
    ) -> None:
        del alice  # set up
        first = asked_from_phone(devices)

        again = asked_from_phone(devices, phone(first.token))

        assert (again.presence, again.code, again.token) == (Presence.WAITING, "0001", None)

    def test_a_cookie_the_server_never_gave_is_replaced(
        self, devices: DeviceService, alice: Account
    ) -> None:
        del alice  # set up
        asked = asked_from_phone(devices, phone("planted"))

        assert (asked.presence, asked.token) == (Presence.WAITING, "token1")

    def test_telling_who_listens_when_a_device_starts_waiting(
        self, devices: DeviceService, alice: Account
    ) -> None:
        del alice  # set up
        told: list[None] = []
        devices.listen(lambda: told.append(None))

        asked_from_phone(devices)

        assert told == [None]

    def test_allow_all_admits_a_new_device_without_recording_it(
        self, devices: DeviceService, alice: Account
    ) -> None:
        devices.put_admission(alice, Admission.EVERYONE, devices.devices(alice).revision)

        asked = asked_from_phone(devices)

        assert (asked.presence, asked.token) == (Presence.ADMITTED, None)
        assert devices.devices(alice).waiting == ()
        assert devices.devices(alice).allowed == ()

    def test_block_new_devices_refuses_a_new_one(
        self, devices: DeviceService, alice: Account
    ) -> None:
        devices.put_admission(alice, Admission.KNOWN, devices.devices(alice).revision)

        asked = asked_from_phone(devices)

        assert (asked.presence, asked.token) == (Presence.REFUSED, None)

    def test_block_new_devices_keeps_an_allowed_one_in(
        self, devices: DeviceService, alice: Account
    ) -> None:
        token = allowed_phone(devices, alice).token
        devices.put_admission(alice, Admission.KNOWN, devices.devices(alice).revision)

        asked = asked_from_phone(devices, phone(token))

        assert asked.presence is Presence.ALLOWED


class TestWaitingLimits:
    def test_one_device_more_than_may_wait_is_refused(
        self, devices: DeviceService, alice: Account
    ) -> None:
        for n in range(MAX_WAITING):
            asked_from_phone(devices, phone(address=f"192.168.1.{n + 10}"))

        one_more = asked_from_phone(devices, phone(address="192.168.1.99"))

        assert (one_more.presence, one_more.token) == (Presence.REFUSED, None)
        assert len(devices.devices(alice).waiting) == MAX_WAITING

    def test_one_more_from_an_address_than_may_wait_is_refused(
        self, devices: DeviceService, alice: Account
    ) -> None:
        del alice  # set up
        for _ in range(MAX_WAITING_FROM_ONE_ADDRESS):
            asked_from_phone(devices)

        one_more = asked_from_phone(devices)
        from_elsewhere = asked_from_phone(devices, phone(address="192.168.1.24"))

        assert (one_more.presence, from_elsewhere.presence) == (Presence.REFUSED, Presence.WAITING)

    def test_a_device_that_waited_an_hour_frees_its_place(
        self, devices: DeviceService, alice: Account, clock: FakeClock
    ) -> None:
        for _ in range(MAX_WAITING_FROM_ONE_ADDRESS):
            asked_from_phone(devices)
        clock.advance(WAIT_FOR)

        later = asked_from_phone(devices)

        assert later.presence is Presence.WAITING
        assert len(devices.devices(alice).waiting) == 1


class TestAnswering:
    def test_an_allowed_device_is_admitted_and_listed(
        self, devices: DeviceService, alice: Account
    ) -> None:
        token = allowed_phone(devices, alice).token

        verdict = devices.admit(phone(token))

        listed = devices.devices(alice)
        assert verdict == (Verdict.ADMITTED, listed.allowed[0].id)
        assert listed.waiting == ()
        assert [(d.label, d.address) for d in listed.allowed] == [
            ("Safari on iPhone", "192.168.1.23")
        ]

    def test_allowing_tells_who_listens(self, devices: DeviceService, alice: Account) -> None:
        asked_from_phone(devices)
        told: list[None] = []
        devices.listen(lambda: told.append(None))

        devices.allow(alice, devices.devices(alice).waiting[0].id)

        assert told == [None]

    def test_a_device_turned_away_is_refused_for_a_day(
        self, devices: DeviceService, alice: Account, clock: FakeClock
    ) -> None:
        token = asked_from_phone(devices).token
        devices.turn_away(alice, devices.devices(alice).waiting[0].id)

        during = asked_from_phone(devices, phone(token)).presence
        clock.advance(TURNED_AWAY_FOR)
        after = asked_from_phone(devices, phone(token)).presence

        assert (during, after) == (Presence.REFUSED, Presence.WAITING)
        assert devices.admit(phone(token)) == (Verdict.WAITING, None)

    def test_answering_a_device_no_longer_waiting_is_not_found(
        self, devices: DeviceService, alice: Account
    ) -> None:
        with pytest.raises(NotFoundError):
            devices.allow(alice, DeviceId("device9"))

    def test_only_an_admin_answers(
        self, devices: DeviceService, alice: Account, accounts: AccountService
    ) -> None:
        bob = accounts.create_account(alice, NewAccountFactory.member())
        asked_from_phone(devices)
        waiting_id = devices.devices(alice).waiting[0].id

        with pytest.raises(ForbiddenError):
            devices.allow(bob, waiting_id)
        with pytest.raises(ForbiddenError):
            devices.devices(bob)


class TestAdmitting:
    def test_a_new_device_waits_until_it_asks(self, devices: DeviceService, alice: Account) -> None:
        del alice  # set up
        assert devices.admit(phone()) == (Verdict.WAITING, None)

    def test_the_host_is_admitted_without_a_device(
        self, devices: DeviceService, alice: Account
    ) -> None:
        del alice  # set up
        assert devices.admit(HOST) == (Verdict.ADMITTED, None)

    def test_when_an_allowed_device_was_last_seen_is_written_at_most_once_a_minute(
        self, devices: DeviceService, alice: Account, clock: FakeClock, units: sessionmaker[Session]
    ) -> None:
        token = allowed_phone(devices, alice).token
        allowed_at = clock()

        clock.advance(SEEN_RESOLUTION / 2)
        devices.admit(phone(token))
        soon = _stored_last_seen(units)
        clock.advance(SEEN_RESOLUTION / 2)
        devices.admit(phone(token, address="192.168.1.40"))

        assert soon == allowed_at
        assert devices.devices(alice).allowed[0].last_seen_at == clock()
        assert devices.devices(alice).allowed[0].address == "192.168.1.40"
        assert _stored_last_seen(units) == clock()

    def test_the_allowed_devices_outlive_a_restart(
        self,
        devices: DeviceService,
        alice: Account,
        units: sessionmaker[Session],
        clock: FakeClock,
        accounts: AccountService,
    ) -> None:
        token = allowed_phone(devices, alice).token

        restarted = DeviceService(units, clock, accounts)

        assert restarted.admit(phone(token))[0] is Verdict.ADMITTED


class TestUpgrading:
    def test_a_browser_signed_in_before_devices_existed_is_allowed_when_it_asks(
        self, devices: DeviceService, accounts: AccountService, units: sessionmaker[Session]
    ) -> None:
        signed_in = accounts.create_first_admin(NewAccountFactory.admin())
        _started_before_devices(units)

        asked = devices.ask(phone(), SAFARI_ON_IPHONE, session_token=signed_in.token)

        assert (asked.presence, asked.token) == (Presence.ALLOWED, "token1")
        assert _session_device(units) == asked.device_id

    def test_a_browser_signed_in_since_waits(
        self, devices: DeviceService, accounts: AccountService
    ) -> None:
        signed_in = accounts.create_first_admin(NewAccountFactory.admin())

        asked = devices.ask(phone(), SAFARI_ON_IPHONE, session_token=signed_in.token)

        assert asked.presence is Presence.WAITING

    def test_a_session_from_before_that_idled_out_waits(
        self,
        devices: DeviceService,
        accounts: AccountService,
        units: sessionmaker[Session],
        clock: FakeClock,
    ) -> None:
        signed_in = accounts.create_first_admin(NewAccountFactory.admin())
        _started_before_devices(units)
        clock.advance(SESSION_IDLE_TIMEOUT + timedelta(seconds=1))

        asked = devices.ask(phone(), SAFARI_ON_IPHONE, session_token=signed_in.token)

        assert asked.presence is Presence.WAITING


class TestSettingUp:
    def test_the_device_that_sets_up_is_allowed_with_its_session(
        self, devices: DeviceService, accounts: AccountService, units: sessionmaker[Session]
    ) -> None:
        signed_in = accounts.create_first_admin(NewAccountFactory.admin())

        enrolled = devices.allow_first(phone(), SAFARI_ON_IPHONE, session_token=signed_in.token)

        assert devices.admit(phone(enrolled.token)) == (Verdict.ADMITTED, enrolled.device_id)
        assert _session_device(units) == enrolled.device_id


class TestRemoving:
    def test_removing_a_device_ends_its_sessions_and_makes_it_ask_again(
        self,
        devices: DeviceService,
        alice: Account,
        accounts: AccountService,
        units: sessionmaker[Session],
    ) -> None:
        asked = allowed_phone(devices, alice)
        device_id = devices.devices(alice).allowed[0].id
        accounts.sign_in(
            NewAccountFactory.admin().username,
            NewAccountFactory.admin().password,
            device_id=device_id,
        )

        devices.remove(alice, device_id, by=None)

        assert devices.admit(phone(asked.token)) == (Verdict.WAITING, None)
        assert _session_device(units, any_device=True) is None

    def test_removing_the_device_making_the_request_is_refused(
        self, devices: DeviceService, alice: Account
    ) -> None:
        allowed_phone(devices, alice)
        device_id = devices.devices(alice).allowed[0].id

        with pytest.raises(ConflictError):
            devices.remove(alice, device_id, by=device_id)

    def test_removing_all_keeps_the_device_making_the_request(
        self, devices: DeviceService, alice: Account
    ) -> None:
        allowed_phone(devices, alice, "192.168.1.23")
        allowed_phone(devices, alice, "192.168.1.24")
        allowed_phone(devices, alice, "192.168.1.25")
        mine = devices.devices(alice).allowed[1].id

        devices.remove_all(alice, by=mine)

        assert [d.id for d in devices.devices(alice).allowed] == [mine]

    def test_removing_a_device_already_gone_does_nothing(
        self, devices: DeviceService, alice: Account
    ) -> None:
        devices.remove(alice, DeviceId("device9"), by=None)

        assert devices.devices(alice).allowed == ()


class TestTheChoice:
    def test_asking_first_by_default(self, devices: DeviceService, alice: Account) -> None:
        assert devices.devices(alice).admission is Admission.ASK

    def test_a_change_at_a_stale_revision_conflicts(
        self, devices: DeviceService, alice: Account
    ) -> None:
        revision = devices.devices(alice).revision
        devices.put_admission(alice, Admission.EVERYONE, revision)

        with pytest.raises(ConflictError):
            devices.put_admission(alice, Admission.KNOWN, revision)

    def test_only_an_admin_changes_it(
        self, devices: DeviceService, alice: Account, accounts: AccountService
    ) -> None:
        bob = accounts.create_account(alice, NewAccountFactory.member())

        with pytest.raises(ForbiddenError):
            devices.put_admission(bob, Admission.EVERYONE, devices.devices(alice).revision)


def _stored_last_seen(units: sessionmaker[Session]) -> object:
    with units() as db:
        return db.scalars(select(DeviceRow.last_seen_at)).one()


def _session_device(units: sessionmaker[Session], *, any_device: bool = False) -> str | None:
    with units() as db:
        query = select(SessionRow.device_id)
        if any_device:
            query = query.where(SessionRow.device_id.is_not(None))
        return db.scalars(query).first()


def _started_before_devices(units: sessionmaker[Session]) -> None:
    """Mark every session as started before devices were checked, as the upgrade does."""
    with units.begin() as db:
        db.execute(update(SessionRow).values(from_before_devices=True))
