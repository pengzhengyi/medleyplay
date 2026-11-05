"""A site's proxy: the household's own path to it, as one URL checked and rebuilt from its parts.

```text
socks5h://127.0.0.1:7890                http://alice:swordfish@proxy.lan:3128
```

The URL may hold a password, so the Keychain keeps it and the catalog keeps only
a summary: its scheme, host, port, and whether it has a login. Nothing here
reaches a network, and no error or `repr` shows the password.
"""

import base64
import ipaddress
import re
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Final, NoReturn, Self
from urllib.parse import SplitResult, quote, unquote, urlsplit

from medleyplay.domain.errors import InvalidInputError, NotFoundError
from medleyplay.domain.linked_accounts import REDACTED, check_site
from medleyplay.domain.links import BILIBILI_SOURCE

PROXY_SITES: Final = frozenset({BILIBILI_SOURCE})
"""The sites whose plugins take a proxy."""
MAX_PROXY_LENGTH: Final = 512
_HOST: Final = re.compile(r"[a-z0-9]([a-z0-9._-]{0,251}[a-z0-9])?")
_LOOKS_UP_LOCALLY: Final = frozenset({"socks4", "socks4a", "socks5"})
_SHORTEST_PASSWORD: Final = 4
_SHAPE: Final = (
    "A proxy is written like socks5h://127.0.0.1:7890, or http://user:password@host:3128."
)


class ProxyScheme(StrEnum):
    """How medleyplay talks to the proxy."""

    HTTP = "http"
    HTTPS = "https"
    SOCKS5H = "socks5h"
    """SOCKS5 where the proxy looks names up, so the household's resolver never sees them."""


@dataclass(frozen=True)
class ProxySummary:
    """What the household may be shown of a proxy: never its login."""

    scheme: ProxyScheme
    host: str
    port: int
    has_login: bool

    @property
    def display(self) -> str:
        """Return the proxy as `socks5h://127.0.0.1:7890`, without any login."""
        return f"{self.scheme}://{_host_part(self.host)}:{self.port}"


@dataclass(frozen=True)
class ProxyUrl:
    """A checked proxy URL; `url` rebuilds it canonically from its parts."""

    scheme: ProxyScheme
    host: str
    port: int
    user: str | None = field(default=None, repr=False)
    password: str | None = field(default=None, repr=False)

    @classmethod
    def parse(cls, text: str) -> Self:
        """Return the proxy `text` names, or raise `InvalidInputError` without quoting `text`.

        "SOCKS5H://Proxy.LAN:1080/" gives `socks5h://proxy.lan:1080`; a path, query,
        fragment, blank, or control character is refused, as is `socks5`.
        """
        _check_characters(text)
        parts = _split(text)
        scheme = _scheme(parts.scheme)
        if parts.path not in {"", "/"}:
            _refuse("A proxy has no path.")
        host, port = _address(parts.hostname, _port(parts))
        user, password = _login(parts.username, parts.password)
        return cls(scheme, host, port, user, password)

    @property
    def url(self) -> str:
        """Return the URL rebuilt from its parts, with the login written in full."""
        login = _login_part(self.user, self.password)
        return f"{self.scheme}://{login}{_host_part(self.host)}:{self.port}"

    @property
    def summary(self) -> ProxySummary:
        """Return what may be shown of the proxy."""
        return ProxySummary(self.scheme, self.host, self.port, self.user is not None)


def check_proxy_site(site: str) -> str:
    """Return `site`, or raise `NotFoundError` when no plugin takes a proxy for it."""
    try:
        checked = check_site(site)
    except InvalidInputError:
        checked = None
    if checked not in PROXY_SITES:
        message = f"No plugin takes a proxy for {site[:64]!r}."
        raise NotFoundError(message)
    return checked


def proxy_secret_name(site: str) -> str:
    """Return the name a site's proxy is kept under in the Keychain: `proxy:bilibili`."""
    return f"proxy:{check_proxy_site(site)}"


def redact_proxy(text: str, proxy: str | None) -> str:
    """Return `text` with `proxy`'s login replaced, as written, URL-decoded, and as a header.

    `user:password@` is always replaced, however short; the password alone only
    from four characters on, since a shorter one would garble ordinary words.
    """
    if not proxy:
        return text
    parts = urlsplit(proxy)
    if parts.username is None:
        return text
    for needle, replacement in _needles(parts.username, parts.password):
        text = text.replace(needle, replacement)
    return text


def _needles(raw_user: str, raw_password: str | None) -> list[tuple[str, str]]:
    users = {raw_user, unquote(raw_user)}
    passwords = {raw_password, unquote(raw_password)} if raw_password else set()
    logins = {f"{user}:{password}" for user in users for password in passwords} or users
    needles = [(f"{login}@", f"{REDACTED}@") for login in logins]
    if passwords:
        needles += [(login, REDACTED) for login in logins]
        needles.append((_basic(unquote(raw_user), unquote(raw_password or "")), REDACTED))
        needles += [(each, REDACTED) for each in passwords if len(each) >= _SHORTEST_PASSWORD]
    return sorted(needles, key=lambda each: len(each[0]), reverse=True)


def _basic(user: str, password: str) -> str:
    return base64.b64encode(f"{user}:{password}".encode()).decode("ascii")


def _check_characters(text: str) -> None:
    if len(text) > MAX_PROXY_LENGTH:
        _refuse(f"A proxy is at most {MAX_PROXY_LENGTH} characters long.")
    if any(each.isspace() or not each.isprintable() for each in text):
        _refuse("A proxy has no spaces or control characters.")
    if "?" in text or "#" in text:
        _refuse("A proxy has no query or fragment; write ? and # in a password as %3F and %23.")


def _split(text: str) -> SplitResult:
    try:
        return urlsplit(text)
    except ValueError:
        _refuse(_SHAPE)


def _scheme(text: str) -> ProxyScheme:
    if text in _LOOKS_UP_LOCALLY:
        _refuse("Use socks5h, which looks names up through the proxy.")
    try:
        return ProxyScheme(text)
    except ValueError:
        _refuse(f"A proxy is http, https, or socks5h. {_SHAPE}")


def _port(parts: SplitResult) -> int | None:
    try:
        return parts.port
    except ValueError:
        _refuse("A proxy's port is a number from 1 to 65535.")


def _address(host: str | None, port: int | None) -> tuple[str, int]:
    if not host or not _is_host(host):
        _refuse(f"A proxy needs a host. {_SHAPE}")
    if port is None or not 1 <= port <= 65535:  # noqa: PLR2004 -- the range of a TCP port
        _refuse("A proxy needs a port from 1 to 65535.")
    return host, port


def _is_host(host: str) -> bool:
    if _HOST.fullmatch(host):
        return True
    try:
        return ipaddress.ip_address(host).version == 6 and "%" not in host  # noqa: PLR2004 -- IPv6
    except ValueError:
        return False


def _login(raw_user: str | None, raw_password: str | None) -> tuple[str | None, str | None]:
    if raw_user is None:
        return None, None
    user, password = unquote(raw_user), unquote(raw_password or "")
    if not user:
        _refuse("A proxy's login needs a user name.")
    if any(not each.isprintable() for each in user + password):
        _refuse("A proxy's login has no control characters.")
    return user, password or None


def _login_part(user: str | None, password: str | None) -> str:
    if user is None:
        return ""
    secret = "" if password is None else f":{quote(password, safe='')}"
    return f"{quote(user, safe='')}{secret}@"


def _host_part(host: str) -> str:
    return f"[{host}]" if ":" in host else host


def _refuse(why: str) -> NoReturn:
    raise InvalidInputError(why) from None
