"""An Account's ratings of albums, and how a song in the Library takes its album's rating.

A Library album is its album artist (else its artist) and its name, as the Library
groups them. It matches a rated album when both are the same folded, the artist by
either of the rated album's names. When none matches, a trailing note naming an
edition is set aside on both sides and they are compared again, so *Blue (Deluxe
Edition)* finds *Blue [Remaster]*.
"""

import re
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Final, Self

from medleyplay.domain.rules import fold

_TRAILING_NOTE: Final = re.compile(
    r"\s*[(\[\uff08\uff3b]([^()\[\]\uff08\uff09\uff3b\uff3d]*)[)\]\uff09\uff3d]\s*$"
)
"""A note in brackets, half or full width, at the end of a name."""
_EDITION_WORDS: Final = (
    "deluxe",
    "edition",
    "remaster",
    "expanded",
    "bonus",
    "anniversary",
    "reissue",
    "disc",
    "限定",
    "盤",
    "版",
)
"""Words that make a trailing note an edition's, not part of the album's name."""

type _Key = tuple[str, str]
"""A folded artist and a folded album name."""


def edition_removed(name: str) -> str | None:
    """Return `name` without a trailing note naming an edition, or `None` if it has none.

    *Blue (Live)* keeps its note, which names another recording, and a name that is
    only a note keeps it too.
    """
    found = _TRAILING_NOTE.search(name)
    if found is None or not any(word in fold(found.group(1)) for word in _EDITION_WORDS):
        return None
    removed = name[: found.start()].strip()
    return removed or None


def effective_rating(own: int | None, album: int | None) -> int | None:
    """Return an Account's rating of a song: its own rating of it, else of its album."""
    return own if own is not None else album


@dataclass(frozen=True)
class RatedAlbum:
    """An album an Account rated or reviewed, by the keys it matches under.

    `artist_keys` are its artist's names folded, `album_key` its name folded, and
    `plain_key` its name folded with any edition note set aside. `stars` is `None`
    for an album reviewed but not rated; `note` is the review.
    """

    artist_keys: frozenset[str]
    album_key: str
    plain_key: str
    stars: int | None
    note: str = ""

    @classmethod
    def of(
        cls, *, artist: str, artist_localized: str, album: str, stars: int | None, note: str = ""
    ) -> Self:
        """Return the album `album` by `artist`, also known as `artist_localized`."""
        names = {fold(each.strip()) for each in (artist, artist_localized)} - {""}
        return cls(frozenset(names), *album_keys(album), stars, note)


def album_keys(album: str) -> tuple[str, str]:
    """Return an album name folded, then folded with any edition note set aside."""
    key = fold(album.strip())
    removed = edition_removed(album)
    return key, key if removed is None else fold(removed)


class AlbumRatings:
    """The albums one Account rated, to find a Library album's rating among them."""

    def __init__(self, rated: Iterable[RatedAlbum]) -> None:
        """Index `rated`; of several albums alike, the highest rating counts."""
        self._exact: dict[_Key, RatedAlbum] = {}
        self._plain: dict[_Key, RatedAlbum] = {}
        for album in rated:
            if album.album_key == "":
                continue
            for artist in album.artist_keys:
                _keep_best(self._exact, (artist, album.album_key), album)
                _keep_best(self._plain, (artist, album.plain_key), album)
        self._found: dict[tuple[str, str], RatedAlbum | None] = {}

    def __bool__(self) -> bool:
        """Return whether the Account rated or reviewed any album."""
        return bool(self._exact)

    def stars_of(self, artist: str, album: str) -> int | None:
        """Return the rating of the Library album `album` by `artist`, or `None`."""
        found = self.find(artist, album)
        return None if found is None else found.stars

    def find(self, artist: str, album: str) -> RatedAlbum | None:
        """Return the rated album the Library album `album` by `artist` matches, if any."""
        asked = (artist, album)
        if asked not in self._found:
            self._found[asked] = self._look_up(artist, album)
        return self._found[asked]

    def _look_up(self, artist: str, album: str) -> RatedAlbum | None:
        artist_key = fold(artist.strip())
        album_key, plain_key = album_keys(album)
        if artist_key == "" or album_key == "":
            return None
        exact = self._exact.get((artist_key, album_key))
        return exact if exact is not None else self._plain.get((artist_key, plain_key))


def _keep_best(index: dict[_Key, RatedAlbum], key: _Key, album: RatedAlbum) -> None:
    kept = index.get(key)
    if kept is None or (album.stars or 0) > (kept.stars or 0):
        index[key] = album


class LibraryAlbums:
    """The albums in the Library, to tell which rated albums it has."""

    def __init__(self, albums: Iterable[tuple[str, str]]) -> None:
        """Index `albums`, each its artist and name."""
        self._exact: set[_Key] = set()
        self._plain: set[_Key] = set()
        for artist, album in albums:
            artist_key = fold(artist.strip())
            album_key, plain_key = album_keys(album)
            if artist_key and album_key:
                self._exact.add((artist_key, album_key))
                self._plain.add((artist_key, plain_key))

    def has(self, rated: RatedAlbum) -> bool:
        """Return whether a Library album matches `rated`, exactly or with editions set aside."""
        return any(
            (artist, rated.album_key) in self._exact or (artist, rated.plain_key) in self._plain
            for artist in rated.artist_keys
        )
