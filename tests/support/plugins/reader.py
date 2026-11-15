"""A plugin that answers for the three enrichers with scripts.

For `bilibili-details`, the video id says how the plugin answers:

| Video | Answers |
| --- | --- |
| `BV1AC4y1L7Yi` | the recorded video's text, and a cover |
| `BVNoCover` | the text of *Night Drive* by *Blue Room*, and no cover |
| `BVNotAnImage` | text, and a cover file that holds no image |
| `BVEscape` | text, and a cover named outside its folder |
| `BVLink` | text, and a cover that is a link to another file |
| `BVHuge` | text, and a cover one byte over the limit |
| `BVFolder` | text, and a cover that is a folder |
| `BVValues` | the genre *Vocaloid* and the year 2014 as values, with a cover |
| `BVBadValues` | a year that is not a year |
| `BVGone` | gone |
| `BVRefused` | refused |
| `BVDown` | a `NetworkError` |
| `BVBroken` | a fault |
| `BVSlow` | text, after two seconds |
| `BVProxyEcho` | text titled with the proxy it was asked through |

For `musicbrainz`, the title the Track shows says how it answers, or its album for a
long file split into songs:

| Title | Answers |
| --- | --- |
| `Nowhere` | no values |
| `Refused` | refused |
| `Down` | a `NetworkError` |
| `Broken` | a fault |
| `BadValues` | a year that is not a year |
| `NoCover` | the values of a song, and no cover |
| `Remaster` | the values of a song titled *Remaster (2016)* |
| `Echo` | the album *echo*, naming how it was asked |
| `Rated` | the values of a song, rated 4.2 from 24 votes, its album 4.55 from 89 |
| `FewVotes` | the values of a song, rated 5 from 2 votes, its album 3.5 from 12 |
| `OffSite` | the values of a song, rated 4 from 9 votes on a page of another site |
| `生如夏花` (a long file) | the album, album artist, year, and a cover |
| `Rated` (a long file) | the same, and the album rated 4.55 from 89 votes |
| any other | the values of *Let Down* on *OK Computer*, and a cover |

For `ai-details`, the title of the video text says how it answers:

| Title | Answers |
| --- | --- |
| `Nowhere` | no values |
| `Album` | an album, an artist, a year, and three songs |
| `Refused` | refused, saying to check the key |
| `Invalid` | invalid |
| `Down` | a `NetworkError` |
| `Broken` | a fault |
| `Leak` | a `NetworkError` that holds every key it was given |
| `BadSongs` | a title, and songs whose starts fall |
| `Echo` | the album *echo*, naming the text, each provider, and whether it has a key |
| `Second` | *Night Drive*, as the last provider, after the first refused |
| any other | the title *Night Drive*, the artist *Blue Room*, an album, and a year |

The artist finder `musicbrainz` answers by the name asked about:

| Name | Answers |
| --- | --- |
| `披头士`, `甲壳虫`, `Beatles` | The Beatles at 100, going by each; a tribute band at 61 |
| `Refuse` | refused |
| any other | no artist |
"""

import time
from pathlib import Path
from typing import Final

from medleyplay.plugin_api import (
    ARTIST_CHOOSER,
    ARTIST_FINDER,
    ARTIST_NAME_FINDER,
    TRACK_ENRICHER,
    AiFailure,
    AiFailureKind,
    AiFailureReason,
    ArtistAlias,
    Chapter,
    ChooseArtists,
    ChosenArtist,
    ChosenArtists,
    CommunityRating,
    Enriched,
    EnrichStatus,
    EnrichTrack,
    FindArtist,
    FindArtistNames,
    FindStatus,
    FoundArtist,
    FoundArtistNames,
    FoundArtists,
    NetworkError,
    Plugin,
    RatedAs,
    Registry,
    SuggestedSong,
    VideoText,
)
from tests.support.images import jpeg_image, oversized_jpeg

RECORDED_TITLE: Final = "【HR 24/48】朴树2003《生如夏花》专辑歌词版"
SONG_PAGE: Final = "https://musicbrainz.org/recording/47b02a82-c3bf-4647-b894-dd1c8f608e7f"
ALBUM_PAGE: Final = "https://musicbrainz.org/release-group/b1392450-e666-3926-a536-22c65f834433"
_RATINGS: Final = {
    "Rated": (
        CommunityRating(of=RatedAs.SONG, value=4.2, votes=24, link=SONG_PAGE),
        CommunityRating(of=RatedAs.ALBUM, value=4.55, votes=89, link=ALBUM_PAGE),
    ),
    "FewVotes": (
        CommunityRating(of=RatedAs.SONG, value=5, votes=2, link=SONG_PAGE),
        CommunityRating(of=RatedAs.ALBUM, value=3.5, votes=12, link=ALBUM_PAGE),
    ),
    "OffSite": (
        CommunityRating(of=RatedAs.SONG, value=4, votes=9, link="https://example.com/rated"),
    ),
}


class Reader:
    """Answers each scripted video as the table says."""

    def enrich(self, request: EnrichTrack) -> Enriched:
        video, folder = request.video or "", Path(request.folder)
        match video:
            case "BVGone":
                return Enriched(status=EnrichStatus.GONE, message="The video was removed.")
            case "BVRefused":
                return Enriched(status=EnrichStatus.REFUSED, message="HTTP Error 412.")
            case "BVDown":
                message = "Bilibili couldn't be reached."
                raise NetworkError(message)
            case "BVBroken":
                message = "The page changed."
                raise ValueError(message)
            case "BVBadValues":
                return Enriched(values={"year": "last year"})
            case "BVValues":
                return Enriched(
                    values={"genre": "Vocaloid", "year": 2014}, cover=_cover(folder, video)
                )
        if video == "BVSlow":
            time.sleep(2)
        title = f"proxy={request.proxy or 'none'}" if video == "BVProxyEcho" else _title(video)
        return Enriched(video_text=_text(title, video), cover=_cover_of(folder, video))


class Finder:
    """Answers each scripted Track as the table says."""

    def enrich(self, request: EnrichTrack) -> Enriched:
        shown = {each.field: each.value for each in request.shown}
        folder = Path(request.folder)
        key = str(shown.get("album" if request.whole_album else "title", ""))
        match key:
            case "Nowhere":
                return Enriched()
            case "Refused":
                return Enriched(status=EnrichStatus.REFUSED, message="HTTP Error 403.")
            case "Down":
                message = "MusicBrainz couldn't be reached."
                raise NetworkError(message)
            case "Broken":
                message = "The answer changed shape."
                raise ValueError(message)
            case "BadValues":
                return Enriched(values={"year": "last year"})
            case "Echo":
                return Enriched(values={"album": _echo(request, shown)})
        if request.whole_album:
            values: dict[str, str | int] = {"album": key, "album_artist": "朴树", "year": 2003}
            albums = tuple(each for each in _RATINGS.get(key, ()) if each.of is RatedAs.ALBUM)
            return Enriched(values=values, ratings=albums, cover=_cover(folder, key))
        title = "Remaster (2016)" if key == "Remaster" else key
        values = {
            "title": title,
            "artist": "Radiohead",
            "album": "OK Computer",
            "album_artist": "Radiohead",
            "year": 1997,
            "track_number": 5,
            "disc_number": 1,
        }
        return Enriched(
            values=values,
            ratings=_RATINGS.get(key, ()),
            cover=None if key == "NoCover" else _cover(folder, key),
        )


_SUGGESTIONS: Final = {
    "Nowhere": Enriched(),
    "Refused": Enriched(
        status=EnrichStatus.REFUSED,
        message="The AI provider refused the key or the account (401). Check the key.",
    ),
    "Invalid": Enriched(
        status=EnrichStatus.INVALID, message="The AI model's answer was not the JSON asked for."
    ),
    "Album": Enriched(
        values={"artist": "Blue Room", "album": "Re:Start", "year": 2016},
        songs=(
            SuggestedSong(start_ms=0, title="Intro"),
            SuggestedSong(start_ms=192_000, title="Night Drive", artist="Blue Room"),
            SuggestedSong(start_ms=4_060_000, title="Outro"),
        ),
    ),
    "BadSongs": Enriched(
        values={"title": "Night Drive"},
        songs=(
            SuggestedSong(start_ms=60_000, title="Intro"),
            SuggestedSong(start_ms=0, title="Outro"),
        ),
    ),
}
_NIGHT_DRIVE: Final = Enriched(
    values={"title": "Night Drive", "artist": "Blue Room", "album": "Re:Start", "year": 2016}
)


class Suggester:
    """Answers each scripted video text as the table says."""

    def enrich(self, request: EnrichTrack) -> Enriched:
        title = request.text.title if request.text is not None else ""
        match title:
            case "Down":
                message = "The AI provider couldn't be reached."
                raise NetworkError(message)
            case "Broken":
                message = "The answer changed shape."
                raise ValueError(message)
            case "Leak":
                message = f"The AI provider couldn't be reached with {_key_of(request)}."
                raise NetworkError(message)
            case "Echo":
                return Enriched(values={"album": _echo_ai(request)})
            case "Second":
                refused = AiFailure(provider=request.ai[0].id, kind=AiFailureKind.REFUSED)
                return _NIGHT_DRIVE.model_copy(
                    update={"ai_answered": request.ai[-1].id, "ai_failures": (refused,)}
                )
            case "Rejected":
                rejected = AiFailure(
                    provider=request.ai[0].id,
                    kind=AiFailureKind.UNUSABLE,
                    reason=AiFailureReason.REJECTED,
                    status=400,
                )
                return _NIGHT_DRIVE.model_copy(
                    update={"ai_answered": request.ai[-1].id, "ai_failures": (rejected,)}
                )
        # As the real plugin does, the answer names the provider that gave it: the first.
        answered = request.ai[0].id if request.ai else None
        return _SUGGESTIONS.get(title, _NIGHT_DRIVE).model_copy(update={"ai_answered": answered})


def _key_of(request: EnrichTrack) -> str:
    return " and ".join(each.key or "no key" for each in request.ai) or "no provider"


def _echo_ai(request: EnrichTrack) -> str:
    text = request.text
    provider = (
        " | ".join(f"{ai.base_url} {ai.model} key={ai.key is not None}" for ai in request.ai)
        or "none"
    )
    words = "none" if text is None else f"{len(text.description)} {len(text.chapters)}"
    echoed = f"provider={provider} text={words} file={request.file_name or 'none'}"
    return f"{echoed} hint={request.hint}" if request.hint else echoed


def _echo(request: EnrichTrack, shown: dict[str, str | int]) -> str:
    return (
        f"whole_album={request.whole_album} video={request.video} proxy={request.proxy or 'none'}"
        f" duration={request.duration_ms} file={request.file_name or 'none'}"
        f" shown={sorted(shown)}"
    )


def _title(video: str) -> str:
    return RECORDED_TITLE if video == "BV1AC4y1L7Yi" else "Night Drive / Blue Room"


def _text(title: str, video: str) -> VideoText:
    chapters = (Chapter(start_ms=0, title="Night Drive"),) if video == "BVSlow" else ()
    return VideoText(title=title, description="-", chapters=chapters)


def _cover_of(folder: Path, video: str) -> str | None:
    if video == "BVNoCover":
        return None
    if video == "BVEscape":
        return "../cover"
    cover = folder / "cover"
    match video:
        case "BVNotAnImage":
            cover.write_text("not an image", encoding="utf-8")
        case "BVLink":
            cover.symlink_to("/etc/hosts")
        case "BVFolder":
            cover.mkdir()
        case "BVHuge":
            cover.write_bytes(oversized_jpeg())
        case _:
            return _cover(folder, video)
    return cover.name


def _cover(folder: Path, video: str) -> str:
    (folder / "cover").write_bytes(jpeg_image(video))
    return "cover"


BEATLES: Final = FoundArtist(
    id="b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d",
    name="The Beatles",
    sort_name="Beatles, The",
    country="GB",
    score=100,
    aliases=(
        ArtistAlias(name="Beatles"),
        ArtistAlias(name="披头士", locale="zh", primary=True),
        ArtistAlias(name="甲壳虫", locale="zh"),
    ),
)
TRIBUTE: Final = FoundArtist(
    id="6a3b5c1e-0000-4000-8000-0000000b0a1d",
    name="披头士乐队纪念乐团",
    disambiguation="Beatles tribute band",
    country="CN",
    score=61,
)


class Artists:
    """Answers each scripted name as the table says."""

    def find(self, request: FindArtist) -> FoundArtists:
        if request.name in {"披头士", "甲壳虫", "Beatles"}:
            return FoundArtists(artists=(BEATLES, TRIBUTE))
        if request.name == "Refuse":
            return FoundArtists(status=FindStatus.REFUSED, message="MusicBrainz refused.")
        return FoundArtists()


BEATLES_PHOTO: Final = jpeg_image("The Beatles")
"""The photo of The Beatles the name finder gives."""


class ArtistNames:
    """Answers as Wikidata would: The Beatles go by 甲壳虫乐队, ビートルズ, and Beatles too.

    It also gives them *Various*, a name of no one artist, which no real answer gave,
    so a test can show such a name offers no artist, and their page and photo,
    `BEATLES_PHOTO`, written into the folder when it is asked with one. Wikidata
    refuses to answer for the tribute band, and knows no other artist.
    """

    def find(self, request: FindArtistNames) -> FoundArtistNames:
        if request.musicbrainz_id == BEATLES.id:
            if request.folder:
                (Path(request.folder) / "photo").write_bytes(BEATLES_PHOTO)
            return FoundArtistNames(
                aliases=(
                    ArtistAlias(name="甲壳虫乐队", locale="zh"),
                    ArtistAlias(name="ビートルズ", locale="ja", primary=True),
                    ArtistAlias(name="Beatles", locale="en"),
                    ArtistAlias(name="Various", locale="en"),
                ),
                page="https://www.wikidata.org/wiki/Q1299",
                photo="photo" if request.folder else None,
                photo_page="https://commons.wikimedia.org/wiki/File:The_Beatles.jpg",
            )
        if request.musicbrainz_id == TRIBUTE.id:
            return FoundArtistNames(status=FindStatus.REFUSED, message="Wikidata refused.")
        return FoundArtistNames()


class ArtistChoices:
    """Answers as an AI model might, judging by the songs it is shown.

    A name stands for the option that is The Beatles, unless a song of it is a tribute,
    when it stands for none. A song *Refused* has the provider refuse the key, and a
    song *Silence* has it choose for no name.
    """

    def choose(self, request: ChooseArtists) -> ChosenArtists:
        songs = [song for each in request.names for song in each.songs]
        if any(song.startswith("Refused") for song in songs):
            return ChosenArtists(status=FindStatus.REFUSED, message="The key was refused.")
        if any(song.startswith("Silence") for song in songs):
            return ChosenArtists(ai_answered=request.ai[0].id)
        chosen = []
        for each in request.names:
            beatles = next((one for one in each.options if one.name == "The Beatles"), None)
            if beatles is None or any("Tribute" in song for song in each.songs):
                chosen.append(ChosenArtist(name=each.name, artist_id=None, why="A tribute"))
            else:
                why = "The Beatles, by its songs"
                chosen.append(ChosenArtist(name=each.name, artist_id=beatles.id, why=why))
        return ChosenArtists(chosen=tuple(chosen), ai_answered=request.ai[0].id)


def register(registry: Registry) -> None:
    """Add the enrichers `bilibili-details`, `musicbrainz`, and `ai-details`, and the rest.

    The rest are two artist finders and an artist chooser.
    """
    registry.add(TRACK_ENRICHER, "bilibili-details", Reader())
    registry.add(TRACK_ENRICHER, "musicbrainz", Finder())
    registry.add(TRACK_ENRICHER, "ai-details", Suggester())
    registry.add(ARTIST_FINDER, "musicbrainz", Artists())
    registry.add(ARTIST_NAME_FINDER, "wikipedia", ArtistNames())
    registry.add(ARTIST_CHOOSER, "ai-details", ArtistChoices())


plugin = Plugin(api_version=1, register=register)
