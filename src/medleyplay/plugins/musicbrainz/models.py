"""The parts of MusicBrainz's JSON answers medleyplay reads; every other field is ignored."""

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field


class _Model(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True, frozen=True)


class Credit(_Model):
    """One artist of an artist credit, with the words that join it to the next."""

    name: str
    joinphrase: str = ""


def credited(artists: list[Credit]) -> str:
    """Return an artist credit as it reads: `Daft Punk`, or `GUMI/MAYU` for two artists."""
    return "".join(f"{each.name}{each.joinphrase}" for each in artists).strip()


class FoundRelease(_Model):
    """A release a recording search lists the recording on."""

    id: str
    title: str
    status: str | None = None
    date: str | None = None


class FoundRecording(_Model):
    """A recording a search found, with its score and the releases it is on."""

    id: str
    score: int
    length: int | None = None
    releases: list[FoundRelease] = []


class RecordingSearch(_Model):
    """The answer to a recording search."""

    recordings: list[FoundRecording] = []


class ReleaseHit(_Model):
    """A release a release search found, with its score."""

    id: str
    title: str
    score: int
    status: str | None = None
    date: str | None = None


class ReleaseSearch(_Model):
    """The answer to a release search."""

    releases: list[ReleaseHit] = []


class CoverArt(_Model):
    """Whether the Cover Art Archive holds a front cover for a release."""

    front: bool = False


class Genre(_Model):
    """A genre MusicBrainz's editors gave, and how many of them gave it."""

    name: str
    count: int = 0


def top_genres(genres: list[Genre], most: int = 3) -> str:
    """Return the `most` most counted genres, ties by name, joined as a genre tag reads.

    ```text
    alternative rock (6), rock (3), punk (1), britpop (1)  ->  alternative rock; rock; britpop
    ```
    """
    ranked = sorted(genres, key=lambda genre: (-genre.count, genre.name))
    return "; ".join(genre.name for genre in ranked[:most])


class Rating(_Model):
    """What MusicBrainz's listeners rated something: the mean of their stars, and their number.

    Something nobody rated has no value and no votes.
    """

    value: float | None = None
    votes: Annotated[int, Field(alias="votes-count")] = 0


class Recording(_Model):
    """The recording a release's track is."""

    id: str
    genres: list[Genre] = []
    rating: Rating = Rating()


class ReleaseGroup(_Model):
    """The release group a release belongs to: every edition of one album."""

    id: str
    rating: Rating = Rating()


class ReleaseTrack(_Model):
    """One track of a medium."""

    position: int
    title: str
    recording: Recording
    artist_credit: Annotated[list[Credit], Field(alias="artist-credit")] = []


class Medium(_Model):
    """One disc of a release."""

    position: int = 1
    tracks: list[ReleaseTrack] = []


class Release(_Model):
    """A release looked up with its tracks, artist credits, and release group."""

    id: str
    title: str
    date: str | None = None
    artist_credit: Annotated[list[Credit], Field(alias="artist-credit")] = []
    media: list[Medium] = []
    genres: list[Genre] = []
    cover_art_archive: Annotated[CoverArt, Field(alias="cover-art-archive")] = CoverArt()
    release_group: Annotated[ReleaseGroup | None, Field(alias="release-group")] = None


class Alias(_Model):
    """Another name an artist goes by."""

    name: str
    locale: str | None = None
    primary: bool | None = None


class FoundArtistHit(_Model):
    """An artist an artist search found, with its score and its other names."""

    id: str
    name: str
    score: int = 0
    sort_name: str = Field(default="", alias="sort-name")
    disambiguation: str = ""
    country: str | None = None
    aliases: list[Alias] = []


class ArtistSearch(_Model):
    """The artists an artist search found, best first."""

    artists: list[FoundArtistHit] = []
