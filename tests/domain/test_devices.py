"""Devices: who the household's choice admits, and what a browser says it is."""

import pytest

from medleyplay.domain.devices import Admission, DeviceState, Verdict, admit, is_host, label_of

ASK = Admission.ASK
EVERYONE = Admission.EVERYONE
KNOWN = Admission.KNOWN
ALL_CHOICES = (ASK, EVERYONE, KNOWN)
ALL_STATES = (None, DeviceState.WAITING, DeviceState.ALLOWED, DeviceState.TURNED_AWAY)


@pytest.mark.parametrize("admission", ALL_CHOICES)
@pytest.mark.parametrize("state", ALL_STATES)
def test_the_host_is_always_admitted(admission: Admission, state: DeviceState | None) -> None:
    verdict = admit(admission, local=True, set_up=True, state=state)

    assert verdict is Verdict.ADMITTED


@pytest.mark.parametrize("admission", ALL_CHOICES)
@pytest.mark.parametrize("state", ALL_STATES)
def test_any_device_is_admitted_before_the_first_account_exists(
    admission: Admission, state: DeviceState | None
) -> None:
    verdict = admit(admission, local=False, set_up=False, state=state)

    assert verdict is Verdict.ADMITTED


@pytest.mark.parametrize("admission", ALL_CHOICES)
def test_an_allowed_device_is_admitted_whatever_the_choice_for_new_ones(
    admission: Admission,
) -> None:
    verdict = admit(admission, local=False, set_up=True, state=DeviceState.ALLOWED)

    assert verdict is Verdict.ADMITTED


@pytest.mark.parametrize("state", [None, DeviceState.WAITING])
@pytest.mark.parametrize(
    ("admission", "expected"),
    [(ASK, Verdict.WAITING), (EVERYONE, Verdict.ADMITTED), (KNOWN, Verdict.REFUSED)],
)
def test_a_new_or_waiting_device_waits_only_when_asking_first(
    admission: Admission, expected: Verdict, state: DeviceState | None
) -> None:
    verdict = admit(admission, local=False, set_up=True, state=state)

    assert verdict is expected


@pytest.mark.parametrize(
    ("admission", "expected"),
    [(ASK, Verdict.REFUSED), (EVERYONE, Verdict.ADMITTED), (KNOWN, Verdict.REFUSED)],
)
def test_a_device_turned_away_is_refused_unless_all_are_allowed(
    admission: Admission, expected: Verdict
) -> None:
    verdict = admit(admission, local=False, set_up=True, state=DeviceState.TURNED_AWAY)

    assert verdict is expected


@pytest.mark.parametrize(
    ("peer", "local"),
    [
        ("127.0.0.1", "127.0.0.1"),
        ("::1", "::1"),
        ("127.0.0.1", "192.168.1.5"),
        ("192.168.1.5", "192.168.1.5"),
        ("::ffff:192.168.1.5", "192.168.1.5"),
        ("::ffff:192.168.1.5", "::ffff:192.168.1.5"),
        ("127.0.0.1", "medleyplay.local"),
    ],
)
def test_a_connection_from_loopback_or_to_its_own_address_is_the_host(
    peer: str, local: str
) -> None:
    assert is_host(peer, local, forwarded=False)


@pytest.mark.parametrize(
    ("peer", "local"),
    [
        ("192.168.1.23", "192.168.1.5"),
        ("::ffff:192.168.1.23", "::ffff:192.168.1.5"),
        ("fe80::1%en0", "fe80::2%en0"),
        ("testclient", "testserver"),
    ],
)
def test_a_connection_from_another_address_is_not_the_host(peer: str, local: str) -> None:
    assert not is_host(peer, local, forwarded=False)


def test_a_forwarded_connection_from_loopback_is_not_the_host() -> None:
    assert not is_host("127.0.0.1", "127.0.0.1", forwarded=True)


@pytest.mark.parametrize(
    ("user_agent", "label"),
    [
        (
            (
                "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15"
                " (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1"
            ),
            "Safari on iPhone",
        ),
        (
            (
                "Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15"
                " (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1"
            ),
            "Chrome on iPad",
        ),
        (
            (
                "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36"
                " (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"
            ),
            "Chrome on Android",
        ),
        (
            (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15"
                " (KHTML, like Gecko) Version/18.1 Safari/605.1.15"
            ),
            "Safari on Mac",
        ),
        (
            (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                " (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.2903.51"
            ),
            "Edge on Windows",
        ),
        (
            "Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0",
            "Firefox on Linux",
        ),
        (
            (
                "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15"
                " (KHTML, like Gecko) FxiOS/132.0 Mobile/15E148 Safari/605.1.15"
            ),
            "Firefox on iPhone",
        ),
    ],
)
def test_a_label_names_the_browser_and_the_system(user_agent: str, label: str) -> None:
    assert label_of(user_agent) == label


@pytest.mark.parametrize("user_agent", ["", "curl/8.7.1"])
def test_a_browser_it_cannot_tell_is_a_browser(user_agent: str) -> None:
    assert label_of(user_agent) == "A browser"


def test_a_known_system_with_an_unknown_browser_names_the_system() -> None:
    label = label_of("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Vivaldi")

    assert label == "A browser on Mac"
