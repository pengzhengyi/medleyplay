"""Devices: which browsers may reach the server, by the household's choice for new ones.

`admit` is a pure function of the choice, where a request comes from, and what
is known of the device:

| Request from               | Ask first | Allow all | Block new |
| -------------------------- | --------- | --------- | --------- |
| The host                   | admitted  | admitted  | admitted  |
| Anyone, before an account  | admitted  | admitted  | admitted  |
| An allowed device          | admitted  | admitted  | admitted  |
| A new or waiting device    | waits     | admitted  | refused   |
| A device turned away       | refused   | admitted  | refused   |
"""

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from ipaddress import IPv4Address, IPv6Address, ip_address
from typing import Final, NewType

DeviceId = NewType("DeviceId", str)

_BROWSERS: Final = (
    ("Edg/", "Edge"),
    ("EdgiOS/", "Edge"),
    ("FxiOS/", "Firefox"),
    ("Firefox/", "Firefox"),
    ("CriOS/", "Chrome"),
    ("Chrome/", "Chrome"),
    ("Safari/", "Safari"),
)
"""Each browser's mark, checked in order: Edge's and Chrome's say Safari too."""
_SYSTEMS: Final = (
    ("iPhone", "iPhone"),
    ("iPad", "iPad"),
    ("Android", "Android"),
    ("Macintosh", "Mac"),
    ("Windows", "Windows"),
    ("Linux", "Linux"),
)
"""Each system's mark, checked in order: Android's says Linux too."""


class Admission(StrEnum):
    """What the household chose for new devices: ask first, allow them all, or block them."""

    ASK = "ask"
    EVERYONE = "everyone"
    KNOWN = "known"


class DeviceState(StrEnum):
    """What is known of one device: it waits for an answer, is allowed, or was turned away."""

    WAITING = "waiting"
    ALLOWED = "allowed"
    TURNED_AWAY = "turned_away"


class Verdict(StrEnum):
    """What becomes of a request: it goes on, waits for an answer, or is refused."""

    ADMITTED = "admitted"
    WAITING = "waiting"
    REFUSED = "refused"


@dataclass(frozen=True)
class Device:
    """A browser other than the host's that the household allowed, known by its cookie's token."""

    id: DeviceId
    label: str
    address: str
    allowed_at: datetime
    last_seen_at: datetime


def admit(admission: Admission, *, local: bool, set_up: bool, state: DeviceState | None) -> Verdict:
    """Return what becomes of a request; `state` is None for a device not yet known."""
    if local or not set_up:
        return Verdict.ADMITTED
    if state is DeviceState.ALLOWED or admission is Admission.EVERYONE:
        return Verdict.ADMITTED
    if state is DeviceState.TURNED_AWAY or admission is Admission.KNOWN:
        return Verdict.REFUSED
    return Verdict.WAITING


def is_host(peer: str, local: str, *, forwarded: bool) -> bool:
    """Return whether a connection from `peer` to `local` comes from the machine itself.

    One a proxy forwarded never does, since behind a proxy on the host every
    connection comes from loopback.
    """
    if forwarded:
        return False
    try:
        peer_address, local_address = _unwrapped(peer), _unwrapped(local)
    except ValueError:
        return False
    return peer_address.is_loopback or peer_address == local_address


def _unwrapped(address: str) -> IPv4Address | IPv6Address:
    """Return the address, an IPv4 one seen through an IPv6 socket as itself."""
    parsed = ip_address(address.split("%", 1)[0])
    if isinstance(parsed, IPv6Address) and parsed.ipv4_mapped is not None:
        return parsed.ipv4_mapped
    return parsed


def label_of(user_agent: str) -> str:
    """Return what a browser says it is, as "Safari on iPhone", for people to tell devices apart."""
    browser = next((name for mark, name in _BROWSERS if mark in user_agent), None)
    system = next((name for mark, name in _SYSTEMS if mark in user_agent), None)
    if system is None:
        return "A browser"
    return f"{browser or 'A browser'} on {system}"
