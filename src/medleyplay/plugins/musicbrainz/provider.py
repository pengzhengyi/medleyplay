"""The enricher: finds a Track on MusicBrainz and reads its release into values and a cover."""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Final

from medleyplay.plugin_api import CommunityRating, Enriched, EnrichStatus, EnrichTrack, RatedAs
from medleyplay.plugins.musicbrainz import matching
from medleyplay.plugins.musicbrainz.client import MusicBrainzClient, RefusedError
from medleyplay.plugins.musicbrainz.matching import Candidate
from medleyplay.plugins.musicbrainz.models import (
    Rating,
    Release,
    ReleaseTrack,
    credited,
    top_genres,
)

COVER_NAME: Final = "cover"
SITE: Final = "https://musicbrainz.org"
MAX_TEXT: Final = 512
YEARS: Final = range(1000, 3000)
"""The years a Track may have."""
NUMBERS: Final = range(1, 1000)
"""The numbers a Track or disc may have."""


@dataclass(frozen=True)
class Terms:
    """What a Track shows that MusicBrainz is searched with."""

    title: str | None = None
    artist: str | None = None
    album: str | None = None
    album_artist: str | None = None


@dataclass(frozen=True)
class MusicBrainz:
    """Asks MusicBrainz for a Track's release: its details, and its front cover."""

    client: MusicBrainzClient = field(default_factory=MusicBrainzClient)

    def enrich(self, request: EnrichTrack) -> Enriched:
        """Find the Track's release and write its front cover into the request's folder.

        No release that fits is an answer with no values. MusicBrainz blocking the
        request is a refusal; a network failure is raised.
        """
        terms = _terms(request)
        try:
            if request.whole_album:
                return self._release_of(terms, request.folder)
            return self._recording_of(terms, request)
        except RefusedError as error:
            return Enriched(status=EnrichStatus.REFUSED, message=str(error)[:512])

    def _recording_of(self, terms: Terms, request: EnrichTrack) -> Enriched:
        if terms.title is None or terms.artist is None:
            return Enriched()
        query = matching.recording_query(terms.title, terms.artist, terms.album)
        chosen = matching.best(self._candidates(query, request.duration_ms), terms.album)
        if chosen is None and terms.album is not None:
            # The album shown may be no release's, such as a video's playlist name.
            query = matching.recording_query(terms.title, terms.artist)
            chosen = matching.best(self._candidates(query, request.duration_ms), terms.album)
        if chosen is None:
            return Enriched()
        release = self.client.release(chosen.release)
        if release is None:
            return Enriched()
        values = _release_values(release)
        ratings = _album_rating(release)
        if chosen.recording is not None:
            values |= _track_values(release, chosen.recording)
            ratings = _song_rating(release, chosen.recording) + ratings
        return Enriched(values=values, ratings=ratings, cover=self._cover(release, request.folder))

    def _candidates(self, query: str, duration_ms: int | None) -> list[Candidate]:
        """Return each release of each recording the query finds near the Track's length."""
        return [
            Candidate(
                release.id,
                release.title,
                found.score,
                release.status == "Official",
                release.date,
                found.id,
            )
            for found in self.client.search_recordings(query).recordings
            if matching.within_window(duration_ms, found.length)
            for release in found.releases
        ]

    def _release_of(self, terms: Terms, folder: str) -> Enriched:
        artist = terms.album_artist or terms.artist
        if terms.album is None or artist is None:
            return Enriched()
        found = self.client.search_releases(matching.release_query(terms.album, artist))
        candidates = [
            Candidate(each.id, each.title, each.score, each.status == "Official", each.date)
            for each in found.releases
        ]
        chosen = matching.best(candidates, terms.album)
        release = None if chosen is None else self.client.release(chosen.release)
        if release is None:
            return Enriched()
        return Enriched(
            values=_release_values(release),
            ratings=_album_rating(release),
            cover=self._cover(release, folder),
        )

    def _cover(self, release: Release, folder: str) -> str | None:
        if not release.cover_art_archive.front:
            return None
        image = self.client.front_cover(release.id)
        if image is None:
            return None
        (Path(folder) / COVER_NAME).write_bytes(image)
        return COVER_NAME


def _terms(request: EnrichTrack) -> Terms:
    shown = {each.field: each.value for each in request.shown if each.origin != "file_name"}

    def text(name: str) -> str | None:
        value = shown.get(name)
        return value.strip() or None if isinstance(value, str) else None

    return Terms(text("title"), text("artist"), text("album"), text("album_artist"))


def _release_values(release: Release) -> dict[str, str | int]:
    """Return the details the release as a whole gives: its album, album artist, and year."""
    values: dict[str, str | int] = {"album": release.title[:MAX_TEXT]}
    if album_artist := credited(release.artist_credit):
        values["album_artist"] = album_artist[:MAX_TEXT]
    year = release.date[:4] if release.date else ""
    if year.isdigit() and int(year) in YEARS:
        values["year"] = int(year)
    if genre := top_genres(release.genres):
        values["genre"] = genre[:MAX_TEXT]
    return values


def _album_rating(release: Release) -> tuple[CommunityRating, ...]:
    """Return what listeners rated the release's album, its release group, if anyone did."""
    group = release.release_group
    if group is None:
        return ()
    return _rated(RatedAs.ALBUM, group.rating, f"{SITE}/release-group/{group.id}")


def _song_rating(release: Release, recording: str) -> tuple[CommunityRating, ...]:
    """Return what listeners rated the recording, as the release lists it, if anyone did."""
    for medium in release.media:
        for track in medium.tracks:
            if track.recording.id == recording:
                link = f"{SITE}/recording/{recording}"
                return _rated(RatedAs.SONG, track.recording.rating, link)
    return ()


def _rated(of: RatedAs, rating: Rating, link: str) -> tuple[CommunityRating, ...]:
    if rating.value is None or rating.votes < 1:
        return ()
    return (CommunityRating(of=of, value=rating.value, votes=rating.votes, link=link),)


def _track_values(release: Release, recording: str) -> dict[str, str | int]:
    """Return the details of the recording's own track on the release."""
    for medium in release.media:
        for track in medium.tracks:
            if track.recording.id == recording:
                numbers = {"track_number": track.position, "disc_number": medium.position}
                return _values_of(track, release) | {
                    name: number for name, number in numbers.items() if number in NUMBERS
                }
    return {}


def _values_of(track: ReleaseTrack, release: Release) -> dict[str, str | int]:
    artist = credited(track.artist_credit) or credited(release.artist_credit)
    values: dict[str, str | int] = {"title": track.title[:MAX_TEXT]}
    if artist:
        values["artist"] = artist[:MAX_TEXT]
    if genre := top_genres(track.recording.genres):
        values["genre"] = genre[:MAX_TEXT]
    return values
