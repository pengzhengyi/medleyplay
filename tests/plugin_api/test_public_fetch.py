"""Fetching an image from a public site: only there, pinned to the address checked, and briefly."""

import itertools
import socket
from collections.abc import Iterator, Sequence
from dataclasses import dataclass, field
from typing import cast

import pytest

from medleyplay.plugin_api import (
    MAX_COVER_BYTES,
    ImageUnavailableError,
    NetworkError,
    fetch_public_image,
    is_public_address,
    pinned_connection,
)

PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 64
COVER = "https://upload.wikimedia.org/wikipedia/en/b/ba/OK_Computer.png?width=500"
WIKIMEDIA = "198.35.26.112"
PUBLIC_V6 = "2620:0:863:ed1a::2:b"
COVER_PATH = "/wikipedia/en/b/ba/OK_Computer.png?width=500"


@pytest.mark.parametrize(
    "address", [WIKIMEDIA, PUBLIC_V6, "8.8.8.8"], ids=["IPv4", "IPv6", "a resolver"]
)
def test_an_address_on_the_internet_is_public(address: str) -> None:
    assert is_public_address(address)


@pytest.mark.parametrize(
    "address",
    [
        "127.0.0.1",
        "10.0.0.1",
        "172.16.0.1",
        "192.168.1.10",
        "169.254.169.254",
        "100.64.0.1",
        "0.0.0.0",  # noqa: S104 -- the address under test, not one bound
        "224.0.0.1",
        "255.255.255.255",
        "::1",
        "::",
        "fe80::1%en0",
        "fd00::1",
        "::ffff:10.0.0.1",
        "::ffff:192.168.1.10",
        "64:ff9b::a00:1",
        "64:ff9b:1::a00:1",
        "2002:a00:1::",
        "ff02::1",
        "not an address",
    ],
    ids=[
        "loopback",
        "private 10/8",
        "private 172.16/12",
        "private 192.168/16",
        "link-local metadata",
        "carrier-grade NAT",
        "unspecified",
        "multicast",
        "broadcast",
        "IPv6 loopback",
        "IPv6 unspecified",
        "IPv6 link-local, scoped",
        "IPv6 unique local",
        "IPv4-mapped private",
        "IPv4-mapped home",
        "NAT64",
        "local NAT64",
        "6to4",
        "IPv6 multicast",
        "words",
    ],
)
def test_an_address_on_the_household_network_or_reserved_is_not_public(address: str) -> None:
    assert not is_public_address(address)


@dataclass
class _Response:
    status: int
    body: bytes = b""
    headers: dict[str, str] = field(default_factory=dict)
    chunks_read: int = 0

    def getheader(self, name: str) -> str | None:
        return self.headers.get(name)

    def read(self, amount: int) -> bytes:
        self.chunks_read += 1
        start = (self.chunks_read - 1) * amount
        return self.body[start : start + amount]


@dataclass
class _Site:
    """A web of fake sites: each name's addresses, each address's answers, and what was asked."""

    addresses: dict[str, Sequence[str]]
    answers: dict[str, _Response]
    """What each address answers, by `address path`."""
    unreachable: set[str] = field(default_factory=set)
    opened: list[tuple[str, str]] = field(default_factory=list)
    asked: list[tuple[str, dict[str, str]]] = field(default_factory=list)

    def resolve(self, host: str) -> Sequence[str]:
        if host not in self.addresses:
            raise socket.gaierror(socket.EAI_NONAME, "unknown")
        return self.addresses[host]

    def open(self, address: str, host: str, timeout: float) -> "_Connection":
        assert timeout > 0
        self.opened.append((address, host))
        if address in self.unreachable:
            raise ConnectionRefusedError
        return _Connection(self, address)


@dataclass
class _Connection:
    site: _Site
    address: str
    response: _Response | None = None

    def request(self, method: str, path: str, headers: dict[str, str]) -> None:
        assert method == "GET"
        self.site.asked.append((path, headers))
        self.response = self.site.answers[f"{self.address} {path}"]

    def getresponse(self) -> _Response:
        assert self.response is not None
        return self.response

    def close(self) -> None:
        pass


def _wikimedia(
    response: _Response, *, path: str = "/wikipedia/en/b/ba/OK_Computer.png?width=500"
) -> _Site:
    """Upload.wikimedia.org at one public address, answering `response` at `path`."""
    return _Site({"upload.wikimedia.org": [WIKIMEDIA]}, {f"{WIKIMEDIA} {path}": response})


def _fetch(site: _Site, url: str = COVER, now: Iterator[float] | None = None) -> bytes:
    clock = now if now is not None else itertools.repeat(0.0)
    return fetch_public_image(
        url,
        user_agent="medleyplay-test",
        resolve=site.resolve,
        open_connection=site.open,
        now=lambda: float(next(clock)),
    )


def test_an_image_on_a_public_site_is_fetched_from_the_address_checked() -> None:
    site = _wikimedia(_Response(200, PNG))

    image = _fetch(site)

    assert image == PNG
    assert site.opened == [(WIKIMEDIA, "upload.wikimedia.org")]


def test_the_request_asks_for_an_image_uncompressed_and_names_medleyplay() -> None:
    site = _wikimedia(_Response(200, PNG))

    _fetch(site)

    [(path, headers)] = site.asked
    assert path == COVER_PATH
    assert headers == {
        "Accept": "image/jpeg, image/png, image/webp",
        "Accept-Encoding": "identity",
        "User-Agent": "medleyplay-test",
    }


def test_a_name_leading_to_any_household_address_is_refused_without_connecting() -> None:
    site = _wikimedia(_Response(200, PNG))
    site.addresses["upload.wikimedia.org"] = [WIKIMEDIA, "192.168.1.10"]

    with pytest.raises(ImageUnavailableError, match="public"):
        _fetch(site)

    assert site.opened == []


def test_an_address_that_cannot_be_reached_gives_way_to_the_next_checked() -> None:
    site = _wikimedia(_Response(200, PNG))
    site.addresses["upload.wikimedia.org"] = [PUBLIC_V6, WIKIMEDIA]
    site.unreachable.add(PUBLIC_V6)

    image = _fetch(site)

    assert image == PNG
    assert site.opened == [(PUBLIC_V6, "upload.wikimedia.org"), (WIKIMEDIA, "upload.wikimedia.org")]


def test_a_site_that_cannot_be_reached_at_all_is_a_network_failure() -> None:
    site = _wikimedia(_Response(200, PNG))
    site.unreachable.add(WIKIMEDIA)

    with pytest.raises(NetworkError):
        _fetch(site)


def test_a_name_nobody_knows_is_no_image() -> None:
    site = _Site({}, {})

    with pytest.raises(ImageUnavailableError, match="isn't known"):
        _fetch(site)


def test_a_name_that_could_not_be_looked_up_now_is_a_network_failure() -> None:
    site = _Site({}, {})

    def resolve(host: str) -> Sequence[str]:
        raise socket.gaierror(socket.EAI_AGAIN, f"try {host} again")

    site.resolve = resolve  # type: ignore[method-assign]

    with pytest.raises(NetworkError):
        _fetch(site)


def test_a_link_off_https_or_to_the_household_is_refused_without_looking_it_up() -> None:
    site = _Site({}, {})

    with pytest.raises(ImageUnavailableError):
        _fetch(site, "https://192.168.1.10/cover.png")

    assert site.opened == []


def test_a_redirect_to_another_public_site_is_followed_and_checked_again() -> None:
    site = _Site(
        {"commons.wikimedia.org": ["198.35.26.96"], "upload.wikimedia.org": [WIKIMEDIA]},
        {
            "198.35.26.96 /wiki/Special:FilePath/OK.png": _Response(
                302, headers={"Location": "https://upload.wikimedia.org/a/OK.png"}
            ),
            f"{WIKIMEDIA} /a/OK.png": _Response(200, PNG),
        },
    )

    image = _fetch(site, "https://commons.wikimedia.org/wiki/Special:FilePath/OK.png")

    assert image == PNG
    assert [address for address, _ in site.opened] == ["198.35.26.96", WIKIMEDIA]


@pytest.mark.parametrize(
    "location",
    ["http://upload.wikimedia.org/a.png", "https://10.0.0.1/a.png", "https://router.lan/a.png"],
    ids=["to plain http", "to a household address", "to a household name"],
)
def test_a_redirect_off_public_https_is_no_image(location: str) -> None:
    site = _wikimedia(_Response(301, headers={"Location": location}))

    with pytest.raises(ImageUnavailableError):
        _fetch(site)

    assert len(site.opened) == 1


def test_a_redirect_to_a_name_leading_home_is_no_image() -> None:
    site = _wikimedia(_Response(302, headers={"Location": "https://evil.example.com/a.png"}))
    site.addresses["evil.example.com"] = ["127.0.0.1"]

    with pytest.raises(ImageUnavailableError):
        _fetch(site)

    assert len(site.opened) == 1


def test_more_than_three_redirects_are_no_image() -> None:
    hop = _Response(302, headers={"Location": "/again"})
    site = _Site({"upload.wikimedia.org": [WIKIMEDIA]}, {f"{WIKIMEDIA} /again": hop})

    with pytest.raises(ImageUnavailableError, match="redirect"):
        _fetch(site, "https://upload.wikimedia.org/again")

    assert len(site.opened) == 4


@pytest.mark.parametrize("status", [404, 410, 403, 401, 400], ids=str)
def test_a_site_saying_there_is_nothing_to_give_is_no_image(status: int) -> None:
    site = _wikimedia(_Response(status))

    with pytest.raises(ImageUnavailableError, match=str(status)):
        _fetch(site)


@pytest.mark.parametrize("status", [429, 500, 503], ids=str)
def test_a_busy_or_failing_site_is_a_network_failure(status: int) -> None:
    site = _wikimedia(_Response(status))

    with pytest.raises(NetworkError, match=str(status)):
        _fetch(site)


def test_an_image_said_to_be_too_large_is_refused_before_reading() -> None:
    response = _Response(200, PNG, headers={"Content-Length": str(MAX_COVER_BYTES + 1)})
    site = _wikimedia(response)

    with pytest.raises(ImageUnavailableError, match="10 MiB"):
        _fetch(site)

    assert response.chunks_read == 0


def test_an_image_that_turns_out_too_large_is_refused() -> None:
    site = _wikimedia(_Response(200, PNG + b"\0" * MAX_COVER_BYTES))

    with pytest.raises(ImageUnavailableError, match="10 MiB"):
        _fetch(site)


def test_a_page_rather_than_an_image_is_no_image() -> None:
    site = _wikimedia(_Response(200, b"<!doctype html><title>OK Computer</title>"))

    with pytest.raises(ImageUnavailableError, match="not an image"):
        _fetch(site)


def test_a_site_answering_too_slowly_is_a_network_failure() -> None:
    site = _wikimedia(_Response(200, PNG * 2000))

    with pytest.raises(NetworkError, match="too long"):
        _fetch(site, now=iter([0, 0, 10, 50, 100]))


def test_what_is_said_never_shows_an_address_looked_up() -> None:
    site = _wikimedia(_Response(200, PNG))
    site.addresses["upload.wikimedia.org"] = ["192.168.1.10"]

    with pytest.raises(ImageUnavailableError) as raised:
        _fetch(site)

    assert "192.168" not in str(raised.value)


@dataclass
class _Tls:
    wrapped: list[str] = field(default_factory=list)

    def wrap_socket(self, sock: socket.socket, *, server_hostname: str) -> socket.socket:
        self.wrapped.append(server_hostname)
        return sock


def test_a_pinned_connection_connects_to_the_address_and_checks_the_name() -> None:
    connected: list[tuple[str, int]] = []
    tls = _Tls()

    def create(address: tuple[str, int], timeout: float) -> socket.socket:
        assert timeout == 5
        connected.append(address)
        return cast("socket.socket", object())

    connection = pinned_connection(WIKIMEDIA, "upload.wikimedia.org", 5, create=create, context=tls)
    connection.connect()

    assert connected == [(WIKIMEDIA, 443)]
    assert tls.wrapped == ["upload.wikimedia.org"]
    assert connection.host == "upload.wikimedia.org"
