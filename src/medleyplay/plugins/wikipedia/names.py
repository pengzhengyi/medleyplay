"""The name finder: every name Wikidata knows an artist by, found by its MusicBrainz id.

Labels come first, as the name Wikidata gives first in a language, then aliases. A
name with a note in brackets, such as *朴树 (歌手)*, is Wikipedia's page title, not
a name the artist goes by, so it is left out.
"""

import re
from dataclasses import dataclass, field
from typing import Final

from medleyplay.plugin_api import (
    MAX_ALIASES,
    ArtistAlias,
    FindArtistNames,
    FindStatus,
    FoundArtistNames,
)
from medleyplay.plugins.wikipedia.client import LANGUAGES, RefusedError, WikidataClient
from medleyplay.plugins.wikipedia.models import Entity

MAX_TEXT: Final = 512
_NOTED: Final = re.compile("[(\uff08][^()\uff08\uff09]*[)\uff09]\\s*$")
"""A note in brackets, ASCII or full-width, ending a name: *朴树 (歌手)*."""
SCRIPT_LENGTH: Final = 4
"""The length of a script subtag, such as `hans`; a region, such as `tw`, is shorter."""


@dataclass(frozen=True)
class WikidataNames:
    """Asks Wikidata every name an artist goes by."""

    client: WikidataClient = field(default_factory=WikidataClient)

    def find(self, request: FindArtistNames) -> FoundArtistNames:
        """Return every name Wikidata knows the artist by; none when it doesn't know it.

        Wikidata refusing the request is a refusal; a network failure is raised.
        """
        try:
            item = self.client.item_of(request.musicbrainz_id)
            entity = None if item is None else self.client.entity(item)
        except RefusedError as error:
            return FoundArtistNames(status=FindStatus.REFUSED, message=str(error)[:500])
        if entity is None:
            return FoundArtistNames()
        return FoundArtistNames(aliases=_aliases(entity))


def _aliases(entity: Entity) -> tuple[ArtistAlias, ...]:
    found: dict[str, ArtistAlias] = {}
    for language in LANGUAGES:
        label = entity.labels.get(language)
        terms = [(label, True)] if label is not None else []
        terms += [(alias, False) for alias in entity.aliases.get(language, [])]
        for term, primary in terms:
            name = term.value.strip()[:MAX_TEXT]
            if name and not _NOTED.search(name) and name not in found:
                found[name] = ArtistAlias(name=name, locale=_locale(language), primary=primary)
    return tuple(found.values())[:MAX_ALIASES]


def _locale(language: str) -> str:
    """Return Wikidata's language code as MusicBrainz writes a locale: `zh-hant` as `zh_Hant`."""
    base, _, rest = language.partition("-")
    if not rest:
        return base
    return f"{base}_{rest.title() if len(rest) == SCRIPT_LENGTH else rest.upper()}"[:16]
