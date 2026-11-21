"""The cover suggested for an album that has none, of the releases a site found for it.

An AI model's pick comes first; else the best-ranked release whose title and artist are
the album's. A cover the household dismissed is never suggested, and none is suggested
rather than a likely wrong one, since using it takes one click.
"""

from collections.abc import Collection, Iterable, Sequence
from dataclasses import dataclass

from medleyplay.domain.album_ratings import album_keys
from medleyplay.domain.artists import goes_by


@dataclass(frozen=True)
class FoundRelease:
    """A release a site found for an album: its title, its artist credit, and its front cover."""

    title: str
    artist: str
    cover: str


def suggested_cover(
    album: str,
    names: Iterable[str],
    found: Sequence[FoundRelease],
    pick: str | None,
    dismissed: Collection[str],
) -> str | None:
    """Return the cover suggested for the album `album` by an artist going by `names`, if any.

    The cover an AI model picked, `pick`, comes first. Else it is the first of `found`,
    best first, whose title is the album's, an edition note set aside on either side,
    and whose artist goes by one of `names`. A cover in `dismissed` is never suggested.
    """
    if pick is not None and pick not in dismissed:
        return pick
    plain = album_keys(album)[1]
    names = list(names)
    for release in found:
        if release.cover in dismissed or album_keys(release.title)[1] != plain:
            continue
        if goes_by(release.artist, names):
            return release.cover
    return None
