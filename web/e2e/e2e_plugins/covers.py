"""The test plugin `covers`, which answers for `musicbrainz` with one cover for any album.

Each album is answered with one release of its own name, by the artist asked for, so its
cover fits and is suggested; nothing reaches MusicBrainz or the Cover Art Archive.
"""

from pathlib import Path

from medleyplay.plugin_api import (
    COVER_FINDER,
    FindCovers,
    FoundCover,
    FoundCovers,
    Plugin,
    Registry,
)
from tests.support.images import jpeg_image

RELEASE = "0a1b2c3d-0000-4000-8000-00000000e2e0"


class Covers:
    """Answers every album with one release of that name, by the artist asked for."""

    def find(self, request: FindCovers) -> FoundCovers:
        (Path(request.folder) / RELEASE).write_bytes(jpeg_image(f"{request.album} cover"))
        release = FoundCover(
            release_id=RELEASE, title=request.album, artist=request.artist, file=RELEASE
        )
        return FoundCovers(covers=(release,))


def register(registry: Registry) -> None:
    registry.add(COVER_FINDER, "musicbrainz", Covers())


plugin = Plugin(api_version=1, register=register)
