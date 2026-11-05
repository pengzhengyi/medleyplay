"""Enrichers: asking a site for the details a file does not say, and which Tracks to ask for.

A Track is asked for when it has a video, is not a song inside a longer file, has no
video text from a file beside it or from the household, and its video was not asked
in the last day:

```text
Music/BV1dm4y1s7ak.m4a     a video id in its file's name       asked
bilibili BV1Xx41117Tz/p1   a video id in its Source            asked
Music/Night Drive.m4a      no video id                         not asked
a song of BV1dm4y1s7ak     its album file is asked instead     not asked
```
"""

import re
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum
from pathlib import PurePosixPath
from typing import Final

from medleyplay.domain.details import Origin
from medleyplay.domain.errors import InvalidInputError
from medleyplay.domain.libraries import LIBRARY_SOURCE, path_of_locator
from medleyplay.domain.links import BILIBILI_SOURCE, parse_part_locator

ASK_AGAIN_AFTER: Final = timedelta(hours=24)
"""How long a video is left alone once an enricher has asked about it."""
BILIBILI_FILE_NAME: Final = re.compile(r"BV[0-9A-Za-z]{10}")
"""A file named for its video: `BV1dm4y1s7ak.m4a`."""


@dataclass(frozen=True)
class Enricher:
    """An enricher the core asks: its name as a plugin key, and how it is asked.

    `origin` is what its values are recorded as, `spacing` the least time between
    two of its calls, and `site` the site whose proxy its calls go through.
    """

    name: str
    origin: Origin
    spacing: timedelta
    site: str


BILIBILI_DETAILS: Final = Enricher(
    name="bilibili-details",
    origin=Origin.VIDEO,
    spacing=timedelta(seconds=5),
    site=BILIBILI_SOURCE,
)
ENRICHERS: Final = {BILIBILI_DETAILS.name: BILIBILI_DETAILS}


def enricher_named(name: str) -> Enricher:
    """Return the enricher called `name`, or raise `InvalidInputError`."""
    enricher = ENRICHERS.get(name)
    if enricher is None:
        message = f"There is no enricher called {name[:64]!r}."
        raise InvalidInputError(message)
    return enricher


def video_id_of(sources: Iterable[tuple[str, str]]) -> str | None:
    """Return the id of the video a Track's Sources name, or `None`.

    `sources` are `(kind, locator)` pairs. A Bilibili Source names its video; a Library
    file named for one, as `3/Music/BV1dm4y1s7ak.m4a` is, does too. A Bilibili Source
    comes first.
    """
    found = list(sources)
    for kind, locator in found:
        if kind == BILIBILI_SOURCE:
            return parse_part_locator(locator)[0]
    for kind, locator in found:
        stem = PurePosixPath(path_of_locator(locator)).stem if kind == LIBRARY_SOURCE else ""
        if BILIBILI_FILE_NAME.fullmatch(stem):
            return stem
    return None


class Ineligible(StrEnum):
    """Why a Track is not asked for."""

    NO_VIDEO = "no_video"
    SEGMENT = "segment"
    HAS_TEXT = "has_text"
    ASKED = "asked"
    STOPPED = "stopped"


MESSAGES: Final = {
    Ineligible.NO_VIDEO: "This Track has no video to look up.",
    Ineligible.SEGMENT: "A song inside a longer file takes its details from that file.",
    Ineligible.HAS_TEXT: "The video's text was read from a file or entered by the household.",
    Ineligible.ASKED: "This video was looked up in the last 24 hours.",
    Ineligible.STOPPED: "Looking up videos is stopped until an admin resets it.",
}


@dataclass(frozen=True)
class TrackFacts:
    """What decides whether a Track is asked for."""

    video: str | None
    is_segment: bool
    text_came_from: str | None
    """Where the Track's video text was read from, or `None` when it has none."""
    asked_at: datetime | None
    """When the video was last asked about, or `None` when it never was."""


def why_not(facts: TrackFacts, now: datetime, *, stopped: bool) -> Ineligible | None:
    """Return why the Track is not asked for now, or `None` when it is."""
    if stopped:
        return Ineligible.STOPPED
    if facts.is_segment:
        return Ineligible.SEGMENT
    if facts.video is None:
        return Ineligible.NO_VIDEO
    if facts.text_came_from in {"file", "household"}:
        return Ineligible.HAS_TEXT
    if facts.asked_at is not None and now - facts.asked_at < ASK_AGAIN_AFTER:
        return Ineligible.ASKED
    return None
