"""Tidies an artist's or an album's name written with more than the name in it.

```text
周杰伦2000年发行首张个人          周杰伦, released 2000
The Beatles（披头士）2000年发行    The Beatles, released 2000
朴树2003                        朴树, released 2003
初音ミク(Hatsune Miku)           初音ミク
```

A release year written with 年 ends the name, and what follows it is a note
about the release; a year ending the name is taken off as a video's title has
it taken off. A bracketed part at the end in another script, Latin against
Chinese, Japanese, or Korean, is a translation, other names, or a note. Names whose numbers or
brackets are their own, such as *The 1975*, *Sum 41*, *f(x)*, and
*ryo(supercell)*, are left as they are, and a name is never split into artists.

An album's name loses the same release year and bracketed translations, and
also a trailing note naming its edition (*(初回限定盤B)*, *(Remastered)*) and an
uploader's advert after a comma (*，超强音质好听到超乎想象不信进来试试！！！*);
a year ending it is its own, as in *1989*.

The tidied name is only offered: the household chooses to use it.
"""  # noqa: RUF002 -- full-width brackets in the examples

import re
from dataclasses import dataclass
from enum import StrEnum
from typing import Final

from medleyplay.domain.album_ratings import edition_removed
from medleyplay.domain.video_text import year_after

# A release year written with 年, but not a decade (年代), and all that follows it.
_RELEASED: Final = re.compile(r"\s*((?:19|20)\d{2})\s*年(?!代).*$", re.DOTALL)
# A part in brackets, half- or full-width, ending the name.
_BRACKETED: Final = re.compile(r"^(.*?)\s*[(\uff08]([^()\uff08\uff09]*)[)\uff09]\s*$")
_EAST_ASIAN: Final = re.compile(r"[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]")
_LATIN: Final = re.compile(r"[A-Za-z]")
_KANA: Final = re.compile(r"[\u3040-\u30ff]")
# The last clause after a comma, half- or full-width.
_LAST_CLAUSE: Final = re.compile(r"\s*[,\uff0c]([^,\uff0c]*)$")
_ADVERT_WORDS: Final = (
    "音质",
    "音質",
    "无损",
    "無損",
    "好听",
    "好聽",
    "进来",
    "進來",
    "试试",
    "試試",
    "必听",
    "必聽",
)
"""Words that make a clause an uploader's advert rather than part of an album's name."""
# A space, `|`, `/`, hyphens, dashes, and the middle dot, full-width forms included.
_SEPARATORS: Final = " |\uff5c/\uff0f-\u2013\u2014\uff0d\u00b7"


class NameKind(StrEnum):
    """What a name names, which decides how it is tidied."""

    ARTIST = "artist"
    """An artist or an album artist."""
    ALBUM = "album"


@dataclass(frozen=True)
class Tidied:
    """An artist's name with the rest taken off, and the release year it named, if any."""

    name: str
    year: int | None


def tidy(kind: NameKind, written: str) -> Tidied | None:
    """Return `written` tidied as a name of `kind`, or `None` when there is nothing to take off."""
    return tidy_artist(written) if kind is NameKind.ARTIST else tidy_album(written)


def tidy_artist(written: str) -> Tidied | None:
    """Return `written` tidied, or `None` when there is nothing to take off.

    A name that tidying would leave with no letters is left as it is too.
    """
    name, year = _without_release(written.strip())
    name = _without_other_script(name)
    if year is None:
        name, year = year_after(name)
    name = " ".join(name.split()).strip(_SEPARATORS)
    if name == written.strip() or not any(char.isalpha() for char in name):
        return None
    return Tidied(name, year)


def tidy_album(written: str) -> Tidied | None:
    """Return the album name `written` tidied, or `None` when there is nothing to take off."""
    name, year = _without_release(written.strip())
    name = _without_advert(name)
    name = edition_removed(name) or name
    name = _without_other_script(name)
    name = " ".join(name.split()).strip(_SEPARATORS)
    if name == written.strip() or not any(char.isalpha() for char in name):
        return None
    return Tidied(name, year)


def _without_advert(text: str) -> str:
    found = _LAST_CLAUSE.search(text)
    if found is None:
        return text
    clause = found.group(1)
    advert = any(word in clause for word in _ADVERT_WORDS) or re.search(
        r"[!\uff01]{2,}\s*$", clause
    )
    return text[: found.start()] if advert else text


def _without_release(text: str) -> tuple[str, int | None]:
    found = _RELEASED.search(text)
    if found is None:
        return text, None
    return text[: found.start()], int(found.group(1))


def _without_other_script(text: str) -> str:
    found = _BRACKETED.match(text)
    if found is None:
        return text
    name, inside = found.group(1), found.group(2)
    return name if name and _scripts_differ(name, inside) else text


def _scripts_differ(name: str, inside: str) -> bool:
    """Return whether the brackets hold a script the name isn't written in.

    A Latin name with Chinese, Japanese, or Korean inside, or the other way round,
    where the inside may also hold the name's own script, as a list of its other
    names does; or a Japanese name, written with kana, with Chinese inside.
    """
    latin = _LATIN.search(name) is not None
    east_asian = _EAST_ASIAN.search(name) is not None
    if latin and not east_asian:
        return _EAST_ASIAN.search(inside) is not None
    if east_asian and not latin:
        if _LATIN.search(inside) is not None:
            return True
        # Japanese with Chinese inside: kana outside, none within.
        return (
            _KANA.search(name) is not None
            and _KANA.search(inside) is None
            and _EAST_ASIAN.search(inside) is not None
        )
    return False
