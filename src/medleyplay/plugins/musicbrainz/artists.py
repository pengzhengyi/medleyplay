"""The finder: the artists MusicBrainz knows by a name, as their name or an alias."""

from dataclasses import dataclass, field
from typing import Final

from medleyplay.plugin_api import (
    MAX_ALIASES,
    MAX_ARTISTS,
    ArtistAlias,
    FindArtist,
    FindStatus,
    FoundArtist,
    FoundArtists,
)
from medleyplay.plugins.musicbrainz.client import MusicBrainzClient, RefusedError
from medleyplay.plugins.musicbrainz.matching import artist_query
from medleyplay.plugins.musicbrainz.models import FoundArtistHit

MAX_TEXT: Final = 512


@dataclass(frozen=True)
class MusicBrainzArtists:
    """Asks MusicBrainz which artists go by a name, with every name each goes by."""

    client: MusicBrainzClient = field(default_factory=MusicBrainzClient)

    def find(self, request: FindArtist) -> FoundArtists:
        """Return the artists MusicBrainz knows by the name, best first.

        MusicBrainz blocking the request is a refusal; a network failure is raised.
        """
        try:
            found = self.client.search_artists(artist_query(request.name))
        except RefusedError as error:
            return FoundArtists(status=FindStatus.REFUSED, message=str(error)[:500])
        return FoundArtists(artists=tuple(_artist(hit) for hit in found.artists[:MAX_ARTISTS]))


def _artist(hit: FoundArtistHit) -> FoundArtist:
    aliases = {
        alias.name[:MAX_TEXT]: ArtistAlias(
            name=alias.name[:MAX_TEXT],
            locale=alias.locale[:16] if alias.locale else None,
            primary=bool(alias.primary),
        )
        for alias in hit.aliases
        if alias.name.strip()
    }
    return FoundArtist(
        id=hit.id,
        name=hit.name[:MAX_TEXT],
        sort_name=hit.sort_name[:MAX_TEXT],
        disambiguation=hit.disambiguation[:MAX_TEXT],
        country=(hit.country or "")[:8],
        score=min(max(hit.score, 0), 100),
        aliases=tuple(aliases.values())[:MAX_ALIASES],
    )
