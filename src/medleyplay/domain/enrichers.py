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
come only from its file's name, or, for a whole album, an album and its artist; and
what it was searched for was not asked in the last day:

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
from medleyplay.domain.links import BILIBILI_SOURCE, CODE_LINK, parse_part_locator, part_link
from medleyplay.domain.lyrics import LyricsSite
from medleyplay.domain.video_text import VideoText

ASK_AGAIN_AFTER: Final = timedelta(hours=24)
"""How long a video is left alone once an enricher has asked about it."""
BILIBILI_FILE_NAME: Final = re.compile(r"BV[0-9A-Za-z]{10}")
"""A file named for its video: `BV1dm4y1s7ak.m4a`."""


class EnricherMode(StrEnum):
    """When an enricher is asked about a Track, as the household chose for it."""

    MANUAL = "manual"
    """Only when someone chooses to, from a Track's menu or its details."""
    NEXT = "next"
    """For the songs a page is about to play, as each comes up."""
    ALL = "all"
    """For every Track it may be asked about, at once and whenever another becomes one."""


class Subject(StrEnum):
    """What an enricher is asked about."""

    VIDEO = "video"
    """A Track's video on a site, named by its id."""
    WORDS = "words"
    """What a Track shows: its title and artist, or its album for a split file."""
    TEXT = "text"
    """A Track's video text, wherever it came from."""
    LYRICS = "lyrics"
    """A song's lyrics, by its title, artist, album, and length."""


class LyricsHeld(StrEnum):
    """Which lyrics a song has already, which decides whether its lyrics are looked up."""

    NONE = "none"
    LOCAL = "local"
    """The household's own, or its files': never replaced by lyrics looked up."""
    ONLINE = "online"
    """Found online before: looked up again only when someone asks."""


@dataclass(frozen=True)
class Enricher:
    """An enricher the core asks: its name as a plugin key, and how it is asked.

    `origin` is what its values are recorded as, or `None` for one that answers no
    details, `subject` what it is asked about, `spacing` the least time between two of
    its calls, and `site` the site whose proxy its calls go through, or `None` when the
    household has none for it. `source` is what it asks, as a refusal names it, and
    `uses_ai` says it asks the AI provider, which it does not until an admin has set it
    up. `rating_hosts` are the hosts the pages of the ratings it answers may be on; an
    enricher with none answers no ratings. A subject is asked about again
    `ask_again_after` the last asking, and the household may choose among `modes`,
    `default_mode` until it does.
    """

    name: str
    origin: Origin | None
    subject: Subject
    spacing: timedelta
    site: str | None
    source: str = "the site"
    uses_ai: bool = False
    rating_hosts: frozenset[str] = frozenset()
    ask_again_after: timedelta = ASK_AGAIN_AFTER
    default_mode: EnricherMode = EnricherMode.MANUAL
    modes: frozenset[EnricherMode] = frozenset(EnricherMode)

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
    rating_hosts=frozenset({"musicbrainz.org"}),
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
LYRICS: Final = Enricher(
    name="lyrics",
    origin=None,
    subject=Subject.LYRICS,
    spacing=timedelta(seconds=1),
    site=None,
    source="a lyrics site",
    ask_again_after=timedelta(days=30),
    default_mode=EnricherMode.NEXT,
    # Every song at once would ask a free service about the whole Library.
    modes=frozenset({EnricherMode.MANUAL, EnricherMode.NEXT}),
)
ENRICHERS: Final = {each.name: each for each in (BILIBILI_DETAILS, MUSICBRAINZ, AI_DETAILS, LYRICS)}


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


def video_page_of(sources: Iterable[tuple[str, str]]) -> str | None:
    """Return the page of the video a Track's Sources came from, or `None`.

    A Bilibili Source links to its part of the video; a Library file named for a
    video, as `3/Music/BV1dm4y1s7ak.m4a` is, to the video.
    """
    found = list(sources)
    for kind, locator in found:
        if kind == BILIBILI_SOURCE:
            return part_link(kind, locator)
    video = video_id_of(found)
    return None if video is None else CODE_LINK.format(code=video)


class Ineligible(StrEnum):
    """Why a Track is not asked for."""

    NO_VIDEO = "no_video"
    NO_WORDS = "no_words"
    NO_TEXT = "no_text"
    NOT_SET_UP = "not_set_up"
    SEGMENT = "segment"
    ALBUM = "album"
    HAS_TEXT = "has_text"
    HAS_LYRICS = "has_lyrics"
    ASKED = "asked"
    STOPPED = "stopped"


_LACKING: Final = {
    Subject.VIDEO: Ineligible.NO_VIDEO,
    Subject.WORDS: Ineligible.NO_WORDS,
    Subject.TEXT: Ineligible.NO_TEXT,
    Subject.LYRICS: Ineligible.NO_WORDS,
}
MESSAGES: Final = {
    Ineligible.NO_VIDEO: "This Track has no video to look up.",
    Ineligible.NO_WORDS: "This Track shows no title and artist, or album, to search for.",
    Ineligible.NO_TEXT: "This Track has no video text for the AI to read.",
    Ineligible.NOT_SET_UP: "The AI provider is not set up yet. An admin can set it up in Settings.",
    Ineligible.SEGMENT: "A song inside a longer file takes its details from that file.",
    Ineligible.ALBUM: "A whole album has no lyrics of its own; its songs do.",
    Ineligible.HAS_TEXT: "The video's text was read from a file or entered by the household.",
    Ineligible.HAS_LYRICS: "This song has lyrics already.",
    Ineligible.ASKED: "This Track was looked up in the last 24 hours.",
    Ineligible.STOPPED: "Looking up Tracks here is stopped until an admin resets it.",
}


def message_of(reason: Ineligible, enricher: Enricher) -> str:
    """Return why a Track is not asked for, as the household reads it."""
    if reason is Ineligible.ASKED:
        wait = enricher.ask_again_after
        since = f"{wait.days} days" if wait.days > 1 else f"{wait // timedelta(hours=1)} hours"
        return f"This Track was looked up in the last {since}."
    return MESSAGES[reason]


@dataclass(frozen=True)
class SearchTerms:
    """What a Track is searched for with, apart from what the searched site said before."""

    title: str | None
    artist: str | None
    album: str | None
    album_artist: str | None
    whole_album: bool
    """The Track is a whole album by its Kind, searched for as a release."""

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
    without its file's name. A song needs a title and an artist; a whole album
    needs an album and, as its artist, the album artist or the artist.
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
    is_album: bool = False
    """The Track is a whole album by its Kind."""
    lyrics_from: LyricsHeld = LyricsHeld.NONE
    """Which lyrics the song has already."""


def lyrics_subject(
    terms: SearchTerms,
    track_id: TrackId,
    duration_ms: int | None,
    sites: tuple[LyricsSite, ...] = (),
) -> str:
    """Return the subject that says a song's lyrics were looked up by these words and length.

    A song whose words or length change, as a corrected title, is a new subject, and so
    is one asked of other `sites` after LRCLIB, as when the household turns one on.
    """
    said = f"lyrics\x1f{terms.key(track_id)}\x1f{duration_ms}"
    if sites:
        said += "\x1f" + ",".join(sites)
    return hashlib.sha256(said.encode()).hexdigest()


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
    again: bool = False,
) -> Ineligible | None:
    """Return why the Track is not asked for now, or `None` when it is.

    `set_up` says whether the AI provider an enricher uses has been set up. Asking the
    AI `again`, as someone chose to, needs no wait since it was last asked.
    """
    if stopped:
        return Ineligible.STOPPED
    if enricher.uses_ai and not set_up:
        return Ineligible.NOT_SET_UP
    if enricher.subject is Subject.LYRICS:
        return _why_not_lyrics(facts, now, enricher, again=again)
    return _why_not_track(facts, now, enricher, again=again and enricher.uses_ai)


def _why_not_track(
    facts: TrackFacts, now: datetime, enricher: Enricher, *, again: bool = False
) -> Ineligible | None:
    if facts.is_segment:
        return Ineligible.SEGMENT
    if facts.subject is None:
        return enricher.lacking
    if enricher.subject is Subject.VIDEO and facts.text_came_from in {"file", "household"}:
        return Ineligible.HAS_TEXT
    return _asked(facts, now, enricher, again=again)


def _why_not_lyrics(
    facts: TrackFacts, now: datetime, enricher: Enricher, *, again: bool
) -> Ineligible | None:
    """A song's own words find its lyrics, a song inside a longer file's too."""
    if facts.is_album:
        return Ineligible.ALBUM
    if facts.subject is None:
        return enricher.lacking
    if facts.lyrics_from is LyricsHeld.LOCAL or (
        facts.lyrics_from is LyricsHeld.ONLINE and not again
    ):
        return Ineligible.HAS_LYRICS
    return _asked(facts, now, enricher, again=again)


def _asked(
    facts: TrackFacts, now: datetime, enricher: Enricher, *, again: bool
) -> Ineligible | None:
    if again or facts.asked_at is None or now - facts.asked_at >= enricher.ask_again_after:
        return None
    return Ineligible.ASKED
