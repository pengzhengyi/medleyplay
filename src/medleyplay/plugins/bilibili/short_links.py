"""Following a `b23.tv` short link to the video link it stands for.

The pasted text is never fetched: the first request is rebuilt from the link's
code, and each redirect is checked before it is followed, so a short link can
only ever lead the plugin to Bilibili's own hosts:

```text
https://b23.tv/abc123  ->  https://www.bilibili.com/video/BV1Xx41117Tz?p=2
```

Every hop goes through the household's proxy when there is one, and direct when
there is none, whatever the environment or the system's settings say.
"""

import functools
import re
from collections.abc import Callable
from typing import Final
from urllib.parse import urljoin, urlsplit

from medleyplay.plugins.bilibili import _ytdlp
from medleyplay.plugins.bilibili.links import SHORT_LINK_HOST

type Fetch = Callable[[str], str | None]
"""Fetch a URL and return where it redirects to, or `None` when it doesn't."""

HOSTS: Final = frozenset({"bilibili.com", "www.bilibili.com", "m.bilibili.com", SHORT_LINK_HOST})
MAX_HOPS: Final = 3
TIMEOUT_SECONDS: Final = 1
"""Each hop's wait, so every hop together stays well inside the call's deadline."""
USER_AGENT: Final = "medleyplay"
_CODE: Final = re.compile(r"/(?P<code>[A-Za-z0-9]{1,32})/?")


def follow_short_link(link: str, fetch: Fetch | None = None, proxy: str | None = None) -> str:
    """Return the link a short link leads to, or the first one off Bilibili's hosts.

    The link returned is never fetched unless it is on Bilibili's hosts, so the
    core can refuse it. A short link with no code, or one that leads nowhere, is
    returned as it is, naming no video. `fetch` replaces the web; by default each
    hop goes through `proxy`.
    """
    fetch = fetch or functools.partial(fetch_redirect, proxy=proxy)
    found = _CODE.fullmatch(urlsplit(link).path)
    if found is None:
        return link
    current = f"https://{SHORT_LINK_HOST}/{found['code']}"
    for _ in range(MAX_HOPS):
        target = fetch(current)
        if target is None:
            return current
        current = urljoin(current, target)
        if not is_allowed(current) or _host(current) != SHORT_LINK_HOST:
            return current
    return current


def is_allowed(link: str) -> bool:
    """Return whether `link` may be fetched: `https` or `http`, a Bilibili host, nothing else."""
    parts = urlsplit(link)
    return (
        parts.scheme in {"https", "http"}
        and "@" not in parts.netloc
        and ":" not in parts.netloc
        and _host(link) in HOSTS
    )


def fetch_redirect(url: str, proxy: str | None = None) -> str | None:
    """Ask for `url` once, through `proxy` if given, and return its redirect.

    It follows no redirect, sends no cookies, and reads no body. A connection that
    fails, or an answer that isn't a redirect, raises `NetworkError`.
    """
    return _ytdlp.read_redirect(url, proxy=proxy, timeout=TIMEOUT_SECONDS, user_agent=USER_AGENT)


def _host(link: str) -> str:
    return urlsplit(link).netloc.lower().removesuffix(".")
