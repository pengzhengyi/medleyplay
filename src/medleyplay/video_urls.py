"""The public portion of a Bilibili share link, safe to keep and hand to the resolver."""

import re
from urllib.parse import parse_qs, urlsplit, urlunsplit

VIDEO_HOSTS = frozenset({"bilibili.com", "www.bilibili.com", "m.bilibili.com", "b23.tv"})


def public_video_link(link: str) -> str:
    """Keep only a recognized host, video or short code, and optional part number."""
    url = urlsplit(link.strip())
    host = url.netloc.lower().removesuffix(".")
    path = url.path.removesuffix("/")
    shape = (
        r"/[a-zA-Z0-9_-]{1,64}"
        if host == "b23.tv"
        else r"/video/(?:[bB][vV][a-zA-Z0-9]{1,62}|[aA][vV][0-9]{1,19})"
    )
    if (
        url.scheme not in {"http", "https"}
        or host not in VIDEO_HOSTS
        or not re.fullmatch(shape, path)
    ):
        msg = "Enter a Bilibili video link, short link, or video code."
        raise ValueError(msg)
    part = parse_qs(url.query).get("p", [""])[0]
    if part and (not re.fullmatch(r"[0-9]{1,4}", part) or not int(part)):
        msg = "A part number is 1 to 9999."
        raise ValueError(msg)
    return urlunsplit((url.scheme, host, path, f"p={int(part)}" if part else "", ""))
