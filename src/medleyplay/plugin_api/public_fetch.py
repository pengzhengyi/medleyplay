"""Fetching an image from a public site, for a plugin fetching a link a model named.

A link may come from anywhere a model read, so the fetch reaches only the public
internet. Each step is checked, not only the first:

1. The link is an address over HTTPS on a public site, by name (`is_public_https`).
2. Every address the name leads to is public, or none is connected to; then each
   is tried in turn, pinned, so the name is never looked up a second time.
3. A redirect is followed by hand, at most three times, each checked from step 1.
4. The answer is read uncompressed, to at most 10 MiB, within 45 seconds in all,
   and kept only if it is a JPEG, PNG, or WebP image.

What can't be fetched raises `ImageUnavailableError`, and asking again won't help;
what may work later, such as a busy site, raises `NetworkError`. Neither says which
address a name led to.
"""

import http.client
import ipaddress
import socket
import ssl
import time
from collections.abc import Callable, Sequence
from typing import Final, Protocol
from urllib.parse import quote, urljoin, urlsplit

from medleyplay.plugin_api.covers import MAX_COVER_BYTES, is_cover_image
from medleyplay.plugin_api.errors import NetworkError
from medleyplay.plugin_api.image_links import HTTPS_PORT, public_host

MAX_REDIRECTS: Final = 3
TIMEOUT: Final = 20.0
"""The longest a site may be silent, in seconds."""
DEADLINE: Final = 45.0
"""The longest a fetch takes in all, in seconds."""
CHUNK: Final = 64 * 1024
_REDIRECTS: Final = frozenset({301, 302, 303, 307, 308})
_TOO_MANY_REQUESTS: Final = 429
_SERVER_ERROR: Final = 500
_UNKNOWN_NAME: Final = frozenset(
    code for code in (socket.EAI_NONAME, getattr(socket, "EAI_NODATA", None)) if code is not None
)
_NOT_PUBLIC: Final = tuple(
    ipaddress.ip_network(network) for network in ("64:ff9b::/96", "64:ff9b:1::/48", "2002::/16")
)
"""IPv6 networks that carry an IPv4 address inside, so may lead anywhere: NAT64 and 6to4."""


class ImageUnavailableError(Exception):
    """There is no image to fetch at the link; asking again won't help."""


def is_public_address(address: str) -> bool:
    """Return whether `address` is a unicast address on the public internet."""
    try:
        ip = ipaddress.ip_address(address.partition("%")[0])
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return (
        ip.is_global and not ip.is_multicast and not any(ip in network for network in _NOT_PUBLIC)
    )


class Response(Protocol):
    """What a connection answers, as `http.client.HTTPResponse` does."""

    status: int

    def getheader(self, name: str) -> str | None:
        """Return the header `name`, or `None`."""
        ...

    def read(self, amount: int) -> bytes:
        """Return at most `amount` more bytes of the body; none at its end."""
        ...


class Connection(Protocol):
    """A connection to one address of a site, as `http.client.HTTPConnection` is."""

    def request(self, method: str, url: str, *, headers: dict[str, str]) -> None:
        """Send a request for `url`, a path, with `headers`."""
        ...

    def getresponse(self) -> Response:
        """Return the answer to the request."""
        ...

    def close(self) -> None:
        """Close the connection."""
        ...


class _Tls(Protocol):
    def wrap_socket(self, sock: socket.socket, *, server_hostname: str) -> socket.socket: ...


type Resolve = Callable[[str], Sequence[str]]
"""Return the addresses a host name leads to; raise `socket.gaierror` when it can't."""
type OpenConnection = Callable[[str, str, float], Connection]
"""Open a connection to an address, for a host name, with a timeout."""


class _PinnedConnection(http.client.HTTPConnection):
    """An HTTPS connection to one address, checking the certificate is the host's."""

    def __init__(
        self,
        address: str,
        host: str,
        timeout: float,
        create: Callable[[tuple[str, int], float], socket.socket],
        context: _Tls,
    ) -> None:
        super().__init__(host, HTTPS_PORT, timeout=timeout)
        self._address = address
        self._seconds = timeout
        self._create = create
        self._context = context

    def connect(self) -> None:
        sock = self._create((self._address, HTTPS_PORT), self._seconds)
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)


def pinned_connection(
    address: str,
    host: str,
    timeout: float,
    *,
    create: Callable[[tuple[str, int], float], socket.socket] = socket.create_connection,
    context: _Tls | None = None,
) -> http.client.HTTPConnection:
    """Return an HTTPS connection to `address` that checks the certificate names `host`."""
    tls = context if context is not None else ssl.create_default_context()
    return _PinnedConnection(address, host, timeout, create, tls)


def resolve_host(host: str) -> Sequence[str]:
    """Return the addresses `host` leads to, in the order to try them."""
    found = socket.getaddrinfo(host, HTTPS_PORT, type=socket.SOCK_STREAM)
    return list(dict.fromkeys(str(info[4][0]) for info in found))


def fetch_public_image(
    url: str,
    *,
    user_agent: str,
    resolve: Resolve = resolve_host,
    open_connection: OpenConnection = pinned_connection,
    now: Callable[[], float] = time.monotonic,
) -> bytes:
    """Return the image at `url`, a link on a public site, fetched as the module says."""
    started = now()
    headers = {
        "Accept": "image/jpeg, image/png, image/webp",
        "Accept-Encoding": "identity",
        "User-Agent": user_agent,
    }
    for _ in range(MAX_REDIRECTS + 1):
        if now() - started > DEADLINE:
            message = "The site took too long to send the image."
            raise NetworkError(message)
        host = public_host(url)
        if host is None:
            message = "The link isn't an address over HTTPS on a public site."
            raise ImageUnavailableError(message)
        connection = _connected(host, resolve, open_connection)
        try:
            connection.request("GET", _path_of(url), headers=headers)
            response = connection.getresponse()
            status = response.status
            if status in _REDIRECTS:
                location = response.getheader("Location")
                if not location:
                    message = f"{host} redirected nowhere ({status})."
                    raise ImageUnavailableError(message)
                url = urljoin(url, location)
                continue
            _check_status(host, status)
            return _image_of(response, lambda: now() - started > DEADLINE)
        except (OSError, http.client.HTTPException) as error:
            message = f"{host} couldn't be reached: {type(error).__name__}."
            raise NetworkError(message) from error
        finally:
            connection.close()
    message = f"The link redirected more than {MAX_REDIRECTS} times."
    raise ImageUnavailableError(message)


def _connected(host: str, resolve: Resolve, open_connection: OpenConnection) -> Connection:
    """Return a connection to the first address of `host` that answers; all must be public."""
    try:
        addresses = resolve(host)
    except socket.gaierror as error:
        if error.errno in _UNKNOWN_NAME:
            message = f"{host} isn't known."
            raise ImageUnavailableError(message) from error
        message = f"{host} couldn't be looked up now."
        raise NetworkError(message) from error
    if not addresses or not all(is_public_address(address) for address in addresses):
        message = f"{host} doesn't lead only to public sites."
        raise ImageUnavailableError(message)
    for address in addresses:
        try:
            return open_connection(address, host, TIMEOUT)
        except OSError:
            continue
    message = f"{host} couldn't be reached."
    raise NetworkError(message)


def _path_of(url: str) -> str:
    parts = urlsplit(url)
    path = quote(parts.path or "/", safe="/%:@!$&'()*+,;=-._~")
    query = quote(parts.query, safe="/%:@!$&'()*+,;=-._~?")
    return f"{path}?{query}" if query else path


def _check_status(host: str, status: int) -> None:
    if status == _TOO_MANY_REQUESTS or status >= _SERVER_ERROR:
        message = f"{host} answered {status}; it may answer later."
        raise NetworkError(message)
    if not 200 <= status < 300:  # noqa: PLR2004 -- HTTP's success range
        message = f"{host} has no image there ({status})."
        raise ImageUnavailableError(message)


def _image_of(response: Response, too_long: Callable[[], bool]) -> bytes:
    too_large = "The image is larger than 10 MiB."
    length = response.getheader("Content-Length")
    if length is not None and length.strip().isdigit() and int(length) > MAX_COVER_BYTES:
        raise ImageUnavailableError(too_large)
    data = bytearray()
    while True:
        if too_long():
            message = "The site took too long to send the image."
            raise NetworkError(message)
        chunk = response.read(CHUNK)
        if not chunk:
            break
        data += chunk
        if len(data) > MAX_COVER_BYTES:
            raise ImageUnavailableError(too_large)
    if not is_cover_image(bytes(data)):
        message = "The link is not an image: not a JPEG, PNG, or WebP image."
        raise ImageUnavailableError(message)
    return bytes(data)
