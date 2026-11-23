"""Remove proxy credentials from text before it leaves a process."""

import base64
from urllib.parse import unquote, urlsplit

REDACTED = "<redacted>"
_SHORTEST_PASSWORD = 4


def redact_proxy(text: str, proxy: str | None) -> str:
    """Remove a proxy login as written, URL-decoded, or encoded as a Basic header."""
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
        basic = base64.b64encode(f"{unquote(raw_user)}:{unquote(raw_password or '')}".encode())
        needles.append((basic.decode("ascii"), REDACTED))
        needles += [(each, REDACTED) for each in passwords if len(each) >= _SHORTEST_PASSWORD]
    return sorted(needles, key=lambda each: len(each[0]), reverse=True)
