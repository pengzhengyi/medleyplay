"""Enrichers: asking a site for the details a file does not say, and which Tracks to ask for.

Each enricher is asked about one kind of subject. A Track is asked about a video when
it has one, is not a song inside a longer file, has no video text from a file beside
it or from the household, and the video was not asked in the last day:

```text
Music/BV1dm4y1s7ak.m4a     a video id in its file's name       asked
bilibili BV1Xx41117Tz/p1   a video id in its Source            asked
Music/Night Drive.m4a      no video id                         not asked
a song of BV1dm4y1s7ak     its album file is asked instead     not asked
```

A Track is searched for by its words when it shows a title and an artist that don't
come only from its file's name, or, for a long file split into songs, an album and
its artist; and what it was searched for was not asked in the last day:

```text
title "Let Down" (files), artist "Radiohead" (files)    searched for as a song
title "Night Drive" (file_name)                         not searched for
album "生如夏花" (video), album artist "朴树" (video)    searched for as a release
```
"""

import hashlib
import json
import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum
from pathlib import PurePosixPath
from typing import Final

from medleyplay.domain.catalog import TrackId
from medleyplay.domain.details import Field, Origin, Values, shown
from medleyplay.domain.errors import NotFoundError
from medleyplay.domain.libraries import LIBRARY_SOURCE, path_of_locator
from medleyplay.domain.links import BILIBILI_SOURCE, parse_part_locator
from medleyplay.domain.video_text import VideoText

ASK_AGAIN_AFTER: Final = timedelta(hours=24)
"""How long a video is left alone once an enricher has asked about it."""
BILIBILI_FILE_NAME: Final = re.compile(r"BV[0-9A-Za-z]{10}")
"""A file named for its video: `BV1dm4y1s7ak.m4a`."""


class Subject(StrEnum):
    """What an enricher is asked about."""

    VIDEO = "video"
    """A Track's video on a site, named by its id."""
    WORDS = "words"
    """What a Track shows: its title and artist, or its album for a split file."""
    TEXT = "text"
    """A Track's video text, wherever it came from."""


@dataclass(frozen=True)
class Enricher:
    """An enricher the core asks: its name as a plugin key, and how it is asked.

    `origin` is what its values are recorded as, `subject` what it is asked about,
    `spacing` the least time between two of its calls, and `site` the site whose
    proxy its calls go through, or `None` when the household has none for it. `source`
    is what it asks, as a refusal names it, and `uses_ai` says it asks the AI provider,
    which it does not until an admin has set it up.
    """

    name: str
    origin: Origin
    subject: Subject
    spacing: timedelta
    site: str | None
    source: str = "the site"
    uses_ai: bool = False

    @property
    def lacking(self) -> "Ineligible":
        """Return why a Track is not asked about when it has nothing to ask about."""
        return _LACKING[self.subject]


BILIBILI_DETAILS: Final = Enricher(
    name="bilibili-details",
    origin=Origin.VIDEO,
    subject=Subject.VIDEO,
    spacing=timedelta(seconds=5),
    site=BILIBILI_SOURCE,
)
MUSICBRAINZ: Final = Enricher(
    name="musicbrainz",
    origin=Origin.MUSICBRAINZ,
    subject=Subject.WORDS,
    spacing=timedelta(seconds=1),
    site=None,
)
AI_DETAILS: Final = Enricher(
    name="ai-details",
    origin=Origin.AI,
    subject=Subject.TEXT,
    spacing=timedelta(seconds=2),
    site=None,
    source="the AI provider",
    uses_ai=True,
)
ENRICHERS: Final = {each.name: each for each in (BILIBILI_DETAILS, MUSICBRAINZ, AI_DETAILS)}


def enricher_named(name: str) -> Enricher:
    """Return the enricher called `name`, or raise `NotFoundError` without repeating the name."""
    enricher = ENRICHERS.get(name)
    if enricher is None:
        message = "There is no such enricher."
        raise NotFoundError(message)
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
    NO_WORDS = "no_words"
    NO_TEXT = "no_text"
    NOT_SET_UP = "not_set_up"
    SEGMENT = "segment"
    HAS_TEXT = "has_text"
    ASKED = "asked"
    STOPPED = "stopped"


_LACKING: Final = {
    Subject.VIDEO: Ineligible.NO_VIDEO,
    Subject.WORDS: Ineligible.NO_WORDS,
    Subject.TEXT: Ineligible.NO_TEXT,
}
MESSAGES: Final = {
    Ineligible.NO_VIDEO: "This Track has no video to look up.",
    Ineligible.NO_WORDS: "This Track shows no title and artist, or album, to search for.",
    Ineligible.NO_TEXT: "This Track has no video text for the AI to read.",
    Ineligible.NOT_SET_UP: "The AI provider is not set up yet. An admin can set it up in Settings.",
    Ineligible.SEGMENT: "A song inside a longer file takes its details from that file.",
    Ineligible.HAS_TEXT: "The video's text was read from a file or entered by the household.",
    Ineligible.ASKED: "This Track was looked up in the last 24 hours.",
    Ineligible.STOPPED: "Looking up Tracks here is stopped until an admin resets it.",
}


@dataclass(frozen=True)
class SearchTerms:
    """What a Track is searched for with, apart from what the searched site said before."""

    title: str | None
    artist: str | None
    album: str | None
    album_artist: str | None
    whole_album: bool
    """The Track is a long file split into songs, searched for as a release."""

    def key(self, track_id: TrackId) -> str:
        """Return the subject that says this Track was asked about these terms.

        A Track asked about again with other terms, such as a title the household
        corrected, is a new subject; so is another Track with the same terms.
        """
        parts = (str(track_id), self.title, self.artist, self.album, self.album_artist)
        text = "\x1f".join("" if part is None else part for part in parts) + str(self.whole_album)
        return hashlib.sha256(text.encode()).hexdigest()


def search_terms(values: Mapping[Origin, Values], *, whole_album: bool) -> SearchTerms | None:
    """Return what the Track is searched for with, or `None` when it shows too little.

    The words come from what the Track shows without the enricher's own word and
    without its file's name. A song needs a title and an artist; a long file split
    into songs needs an album and, as its artist, the album artist or the artist.
    """
    own = {Origin.MUSICBRAINZ, Origin.FILE_NAME}
    kept: dict[Origin, Values] = {o: v for o, v in values.items() if o not in own}
    found = shown(kept)

    def text(field: Field) -> str | None:
        value = found[field].value if field in found else None
        return value.strip() or None if isinstance(value, str) else None

    title, artist, album = text(Field.TITLE), text(Field.ARTIST), text(Field.ALBUM)
    album_artist = text(Field.ALBUM_ARTIST) or (artist if whole_album else None)
    if whole_album:
        if album is None or album_artist is None:
            return None
        return SearchTerms(None, None, album, album_artist, whole_album=True)
    if title is None or artist is None:
        return None
    return SearchTerms(title, artist, album, None, whole_album=False)


@dataclass(frozen=True)
class TrackFacts:
    """What decides whether a Track is asked for."""

    subject: str | None
    """What the Track would be asked about, or `None` when it has nothing to ask about."""
    is_segment: bool
    text_came_from: str | None
    """Where the Track's video text was read from, or `None` when it has none."""
    asked_at: datetime | None
    """When the subject was last asked about, or `None` when it never was."""


def text_subject(track_id: TrackId, text: VideoText) -> str:
    """Return the subject that says the AI was asked about the Track with this text.

    A Track is asked of the AI once a day for one text, so pasting a better
    description asks again at once.
    """
    chapters = [[chapter.start_ms, chapter.title] for chapter in text.chapters]
    said = json.dumps([track_id, text.title, text.description, chapters], ensure_ascii=False)
    return hashlib.sha256(f"ai-details\x1f{said}".encode()).hexdigest()


def why_not(
    facts: TrackFacts,
    now: datetime,
    *,
    stopped: bool,
    enricher: Enricher,
    set_up: bool = True,
) -> Ineligible | None:
    """Return why the Track is not asked for now, or `None` when it is.

    `set_up` says whether the AI provider an enricher uses has been set up.
    """
    if stopped:
        return Ineligible.STOPPED
    if enricher.uses_ai and not set_up:
        return Ineligible.NOT_SET_UP
    return _why_not_track(facts, now, enricher)


def _why_not_track(facts: TrackFacts, now: datetime, enricher: Enricher) -> Ineligible | None:
    if facts.is_segment:
        return Ineligible.SEGMENT
    if facts.subject is None:
        return enricher.lacking
    if enricher.subject is Subject.VIDEO and facts.text_came_from in {"file", "household"}:
        return Ineligible.HAS_TEXT
    if facts.asked_at is not None and now - facts.asked_at < ASK_AGAIN_AFTER:
        return Ineligible.ASKED
    return None
