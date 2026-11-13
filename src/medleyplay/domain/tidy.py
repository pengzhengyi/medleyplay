"""Tidies an artist's name written with more than the name in it.

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

The tidied name is only offered: the household chooses to use it.
"""  # noqa: RUF002 -- full-width brackets in the examples

import re
from dataclasses import dataclass
from typing import Final

from medleyplay.domain.video_text import year_after

# A release year written with 年, but not a decade (年代), and all that follows it.
_RELEASED: Final = re.compile(r"\s*((?:19|20)\d{2})\s*年(?!代).*$", re.DOTALL)
# A part in brackets, half- or full-width, ending the name.
_BRACKETED: Final = re.compile(r"^(.*?)\s*[(\uff08]([^()\uff08\uff09]*)[)\uff09]\s*$")
_EAST_ASIAN: Final = re.compile(r"[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]")
_LATIN: Final = re.compile(r"[A-Za-z]")
# A space, `|`, `/`, hyphens, dashes, and the middle dot, full-width forms included.
_SEPARATORS: Final = " |\uff5c/\uff0f-\u2013\u2014\uff0d\u00b7"


@dataclass(frozen=True)
class Tidied:
    """An artist's name with the rest taken off, and the release year it named, if any."""

    name: str
    year: int | None


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

    A Latin name with Chinese, Japanese, or Korean inside, or the other way round;
    the inside may also hold the name's own script, as a list of its other names does.
    """
    latin = _LATIN.search(name) is not None
    east_asian = _EAST_ASIAN.search(name) is not None
    if latin and not east_asian:
        return _EAST_ASIAN.search(inside) is not None
    if east_asian and not latin:
        return _LATIN.search(inside) is not None
    return False
