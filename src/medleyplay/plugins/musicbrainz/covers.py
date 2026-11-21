"""The cover finder: the front covers of an album's releases, best first.

Releases are searched for by the album and its artist and ranked as the enricher
ranks them; each, in turn, is asked for its front cover until enough are found. Two
releases often share a cover, which is offered once, for the better release:

```text
生如夏花, 朴树
  2003-08-01  CN  CD  11 tracks   offered
  2013-06-21  CN  CD  11 tracks   offered, its cover differing
  朴树精选                         scores 71, not asked
```
"""

import hashlib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Final

from medleyplay.plugin_api import (
    MAX_COVERS,
    FindCovers,
    FindStatus,
    FoundCover,
    FoundCovers,
)
from medleyplay.plugins.musicbrainz import matching
from medleyplay.plugins.musicbrainz.client import MusicBrainzClient, RefusedError, is_release_id
from medleyplay.plugins.musicbrainz.matching import Candidate, release_query
from medleyplay.plugins.musicbrainz.models import ReleaseHit, credited

MAX_TEXT: Final = 512
MAX_TRACKS: Final = 999


@dataclass(frozen=True)
class MusicBrainzCovers:
    """Asks MusicBrainz for an album's releases, and the Cover Art Archive for their covers."""

    client: MusicBrainzClient = field(default_factory=MusicBrainzClient)

    def find(self, request: FindCovers) -> FoundCovers:
        """Return the covers of the album's releases, best first, each written into the folder.

        MusicBrainz or the archive refusing is a refusal; a network failure is raised.
        """
        try:
            found = self.client.search_releases(
                release_query(request.album, request.artist, request.artist_ids)
            )
            hits = {hit.id: hit for hit in found.releases if is_release_id(hit.id)}
            candidates = [
                Candidate(hit.id, hit.title, hit.score, hit.status == "Official", hit.date)
                for hit in hits.values()
            ]
            covers: list[FoundCover] = []
            offered: set[str] = set()
            for candidate in matching.ranked(candidates, request.album)[: request.tried]:
                image = self.client.release_cover(candidate.release)
                if image is None or hashlib.sha256(image).hexdigest() in offered:
                    continue
                offered.add(hashlib.sha256(image).hexdigest())
                (Path(request.folder) / candidate.release).write_bytes(image)
                covers.append(_cover(hits[candidate.release], request.album))
                if len(covers) == MAX_COVERS:
                    break
        except RefusedError as error:
            return FoundCovers(status=FindStatus.REFUSED, message=str(error)[:500])
        return FoundCovers(covers=tuple(covers))


def _cover(hit: ReleaseHit, album: str) -> FoundCover:
    formats = dict.fromkeys(each.format for each in hit.media if each.format)
    tracks = hit.track_count
    return FoundCover(
        release_id=hit.id,
        title=(hit.title or album)[:MAX_TEXT],
        artist=credited(hit.artist_credit)[:MAX_TEXT],
        date=(hit.date or "")[:10],
        country=(hit.country or "")[:8],
        format=" + ".join(formats)[:64],
        tracks=tracks if tracks is not None and 0 <= tracks <= MAX_TRACKS else None,
        file=hit.id,
    )
