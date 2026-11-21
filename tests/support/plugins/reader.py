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

For `lyrics`, the title the song shows says how it answers:

| Title | Answers |
| --- | --- |
| `Nowhere` | no lyrics |
| `Elsewhere` | none, but `lyrics_of(title)` from NetEase once the household turns it on |
| `Instrumental` | an instrumental, with no lyrics |
| `Plain` | plain lyrics, not timed |
| `Refused` | refused |
| `Down` | a `NetworkError` |
| any other | `lyrics_of(title)`, timed |

The artist finder `musicbrainz` answers by the name asked about:

| Name | Answers |
| --- | --- |
| `披头士`, `甲壳虫`, `Beatles` | The Beatles at 100, going by each; a tribute band at 61 |
| `Jay` | Jay Chou at 100 and a rapper called Jay at 95, both going by it; The Jays at 80 |
| `Refuse` | refused |
| any other | no artist |

The cover finder `musicbrainz` answers by the album asked about:

| Album | Answers |
| --- | --- |
| `Help!` | its 1965 vinyl and its 1987 CD, each with its cover |
| `Forged` | one release, whose cover is no image |
| `Refuse` | refused |
| any other | no cover |

The picture finder `deezer` answers by the artist's name:

| Name | Answers |
| --- | --- |
| `The Beatles` | two artists going by it, each with a picture, the most followed first |
| `Refuse` | refused |
| any other | no picture |

The picture chooser `ai-details` picks the most followed picture, or the least followed
when the listener's note says *tribute*; a note *Refuse* has the provider refuse the key.

The cover chooser `ai-details` picks the latest release offered, unless a song of the
album is *Refused*, when the provider refuses the key, or *Silence*, when it picks none.
"""

import re
import time
from pathlib import Path
from typing import Final

from medleyplay.plugin_api import (
    ARTIST_CHOOSER,
    ARTIST_DESCRIBER,
    ARTIST_FINDER,
    ARTIST_NAME_FINDER,
    COVER_CHOOSER,
    COVER_FINDER,
    IMAGE_FETCHER,
    IMAGE_SUGGESTER,
    LYRICS_CHOOSER,
    LYRICS_FINDER,
    PICTURE_CHOOSER,
    PICTURE_FINDER,
    TRACK_ENRICHER,
    AiFailure,
    AiFailureKind,
    AiFailureReason,
    ArtistAlias,
    Chapter,
    ChooseArtists,
    ChooseCover,
    ChooseLyrics,
    ChoosePicture,
    ChosenArtist,
    ChosenArtists,
    ChosenCover,
    ChosenLyrics,
    ChosenPicture,
    CommunityRating,
    DescribeArtist,
    DescribedArtist,
    Enriched,
    EnrichStatus,
    EnrichTrack,
    FetchedImage,
    FetchImage,
    FindArtist,
    FindArtistNames,
    FindCovers,
    FindLyrics,
    FindPictures,
    FindStatus,
    FoundArtist,
    FoundArtistNames,
    FoundArtists,
    FoundCover,
    FoundCovers,
    FoundLyrics,
    FoundLyricsOptions,
    FoundPicture,
    FoundPictures,
    ImageLink,
    ImageSubject,
    LyricsOption,
    LyricsProvider,
    NetworkError,
    Plugin,
    RatedAs,
    Registry,
    SuggestedImages,
    SuggestedSong,
    SuggestImages,
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

JAY_CHOU: Final = FoundArtist(
    id="a3c1f0e2-0000-4000-8000-00000000c40e",
    name="周杰伦",
    sort_name="Chou, Jay",
    country="TW",
    score=100,
    aliases=(ArtistAlias(name="Jay Chou"), ArtistAlias(name="Jay")),
)
JAY_RAPPER: Final = FoundArtist(
    id="5e7b2d9a-0000-4000-8000-0000000a7a9e",
    name="Jay",
    sort_name="Jay",
    disambiguation="UK rapper",
    country="GB",
    score=95,
)
THE_JAYS: Final = FoundArtist(
    id="c0ffee00-0000-4000-8000-0000000ae750",
    name="The Jays",
    sort_name="Jays, The",
    country="US",
    score=80,
)


class Artists:
    """Answers each scripted name as the table says."""

    def find(self, request: FindArtist) -> FoundArtists:
        if request.name in {"披头士", "甲壳虫", "Beatles"}:
            return FoundArtists(artists=(BEATLES, TRIBUTE))
        if request.name == "Jay":
            return FoundArtists(artists=(JAY_CHOU, JAY_RAPPER, THE_JAYS))
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


class ArtistDescriptions:
    """Answers as an AI model might, judging by the names it is offered and the songs.

    It suggests the first Chinese name after the songs' own, and a note naming the
    artist and its country. A song *Refused* has the provider refuse the key, a song
    *Silence* has it suggest nothing, and a song *Forged* has it name a name it was
    not offered.
    """

    def describe(self, request: DescribeArtist) -> DescribedArtist:
        if any(song.startswith("Refused") for song in request.songs):
            return DescribedArtist(status=FindStatus.REFUSED, message="The key was refused.")
        if any(song.startswith("Silence") for song in request.songs):
            return DescribedArtist(ai_answered=request.ai[0].id)
        chinese = [name for name in request.names[1:] if re.search("[\u4e00-\u9fff]", name)]
        forged = any(song.startswith("Forged") for song in request.songs)
        return DescribedArtist(
            shown_as="Someone else" if forged else next(iter(chinese), None),
            why="Its songs are Chinese",
            about=f"{request.artist.name}, from {request.artist.country}.",
            ai_answered=request.ai[0].id,
        )


HELP_VINYL: Final = "0a1b2c3d-0000-4000-8000-000000001965"
"""The 1965 vinyl of *Help!* the cover finder gives first."""
HELP_CD: Final = "0a1b2c3d-0000-4000-8000-000000001987"
"""The 1987 CD of *Help!*, which the cover chooser picks."""


class PictureChoices:
    """Picks the most followed picture, or the least when the note says it is a tribute."""

    def choose(self, request: ChoosePicture) -> ChosenPicture:
        if request.hint == "Refuse":
            return ChosenPicture(status=FindStatus.REFUSED, message="The key was refused.")
        fans = [option.fans or 0 for option in request.options]
        tribute = "tribute" in request.hint
        chosen = fans.index(min(fans) if tribute else max(fans))
        why = "A tribute, by its following" if tribute else "The most followed"
        return ChosenPicture(option=chosen, why=why, ai_answered=request.ai[0].id)


class Pictures:
    """Answers as Deezer would for *The Beatles*, writing each picture into the folder asked for."""

    def find(self, request: FindPictures) -> FoundPictures:
        folder = Path(request.folder)
        if request.artist == "Refuse":
            return FoundPictures(status=FindStatus.REFUSED, message="Deezer refused.")
        if request.artist != "The Beatles":
            return FoundPictures()
        (folder / "1.jpg").write_bytes(jpeg_image("The Beatles"))
        (folder / "2.jpg").write_bytes(jpeg_image("The Beatles Tribute"))
        return FoundPictures(
            pictures=(
                FoundPicture(name="The Beatles", fans=4_100_000, file="1.jpg"),
                FoundPicture(name="The Beatles", fans=120, file="2.jpg"),
            )
        )


class Covers:
    """Answers as MusicBrainz would for *Help!*, writing each cover into the folder asked for."""

    def find(self, request: FindCovers) -> FoundCovers:
        folder = Path(request.folder)
        if request.album == "Refuse":
            return FoundCovers(status=FindStatus.REFUSED, message="MusicBrainz refused.")
        if request.album == "Forged":
            (folder / HELP_VINYL).write_text("not an image", encoding="utf-8")
            return FoundCovers(
                covers=(FoundCover(release_id=HELP_VINYL, title="Forged", file=HELP_VINYL),)
            )
        if request.album != "Help!":
            return FoundCovers()
        (folder / HELP_VINYL).write_bytes(jpeg_image("Help! 1965"))
        (folder / HELP_CD).write_bytes(jpeg_image("Help! 1987"))
        return FoundCovers(
            covers=(
                FoundCover(
                    release_id=HELP_VINYL,
                    title="Help!",
                    artist="The Beatles",
                    date="1965-08-06",
                    country="GB",
                    format='12" Vinyl',
                    tracks=14,
                    file=HELP_VINYL,
                ),
                FoundCover(
                    release_id=HELP_CD,
                    title="Help!",
                    artist="The Beatles",
                    date="1987-04-30",
                    country="GB",
                    format="CD",
                    tracks=14,
                    file=HELP_CD,
                ),
            )
        )


class CoverChoices:
    """Picks the latest release offered, as an AI model might for a remaster's songs."""

    def choose(self, request: ChooseCover) -> ChosenCover:
        if any(song.startswith("Refused") for song in request.songs):
            return ChosenCover(status=FindStatus.REFUSED, message="The key was refused.")
        if any(song.startswith("Silence") for song in request.songs):
            return ChosenCover(ai_answered=request.ai[0].id)
        latest = max(request.options, key=lambda option: option.date)
        return ChosenCover(
            release_id=latest.release_id, why="The CD, by its songs", ai_answered=request.ai[0].id
        )


class LyricsChoices:
    """Picks the timed song found titled as the song; *Refused* is refused, *Silence* none."""

    def choose(self, request: ChooseLyrics) -> ChosenLyrics:
        if request.title.startswith("Refused"):
            return ChosenLyrics(status=FindStatus.REFUSED, message="The key was refused.")
        timed = (
            at
            for at, option in enumerate(request.options)
            if option.timed
            and option.title == request.title
            and not request.title.startswith("Silence")
        )
        option = next(timed, None)
        return ChosenLyrics(
            option=option,
            why="" if option is None else "The studio recording, as long as the file",
            ai_answered=request.ai[0].id,
        )


HELP_LINK: Final = "https://upload.wikimedia.org/wikipedia/en/e/e7/Help!_(The_Beatles_album).jpg"
"""The link to *Help!*'s cover the image suggester names first; the fetcher has it."""
HELP_GONE: Final = "https://upload.wikimedia.org/wikipedia/en/0/00/Help_gone.jpg"
"""A link to *Help!*'s cover the image suggester names that has no image."""
HELP_PAGE: Final = "https://en.wikipedia.org/wiki/Help!"
HELP_FETCHED: Final = jpeg_image("Help! from the web")
"""The image at `HELP_LINK`."""
BEATLES_LINK: Final = "https://upload.wikimedia.org/wikipedia/commons/d/df/The_Fabs.JPG"
"""The link to a photo of The Beatles the image suggester names; the fetcher has it."""
BEATLES_FETCHED: Final = jpeg_image("The Beatles from the web")
"""The image at `BEATLES_LINK`."""


class ImageLinks:
    """Names links as an AI model might: two to *Help!*'s cover, one to The Beatles.

    A song *Refused* has the provider refuse the key, a note saying *first only* has it
    name only the first, and any other album or artist has it name no link.
    """

    def suggest(self, request: SuggestImages) -> SuggestedImages:
        if any(song.startswith("Refused") for song in request.songs):
            return SuggestedImages(status=FindStatus.REFUSED, message="The key was refused.")
        links: tuple[ImageLink, ...] = ()
        if request.subject is ImageSubject.ALBUM and request.name == "Help!":
            links = (
                ImageLink(url=HELP_LINK, page=HELP_PAGE, why="The album's article shows it"),
                ImageLink(url=HELP_GONE),
            )
        if request.subject is ImageSubject.ARTIST and request.name == "The Beatles":
            links = (ImageLink(url=BEATLES_LINK, why="A photo of the band"),)
        if "first only" in request.hint:
            links = links[:1]
        return SuggestedImages(links=links, ai_answered=request.ai[0].id)


class Images:
    """Fetches as the web would: `HELP_LINK` and `BEATLES_LINK` hold images, nothing else."""

    def fetch(self, request: FetchImage) -> FetchedImage:
        images = {HELP_LINK: HELP_FETCHED, BEATLES_LINK: BEATLES_FETCHED}
        if request.url not in images:
            return FetchedImage(message="upload.wikimedia.org has no image there (404).")
        (Path(request.folder) / "image").write_bytes(images[request.url])
        return FetchedImage(file="image")


def lyrics_of(title: str) -> str:
    """The timed lyrics the `lyrics` enricher answers for a song titled `title`."""
    return f"[00:01.00]{title}\n[00:05.50]la la la\n"


PLAIN_LYRICS: Final = "First line\nSecond line"
"""The plain lyrics the `lyrics` enricher answers for a song titled *Plain*."""


class Lyricist:
    """Answers each song's lyrics as the table says."""

    def enrich(self, request: EnrichTrack) -> Enriched:
        title = str({each.field: each.value for each in request.shown}.get("title", ""))
        match title:
            case "Nowhere":
                return Enriched()
            case "Elsewhere" if LyricsProvider.NETEASE not in request.lyrics_sites:
                return Enriched()
            case "Instrumental":
                return Enriched(
                    lyrics=FoundLyrics(provider=LyricsProvider.LRCLIB, instrumental=True)
                )
            case "Plain":
                return Enriched(
                    lyrics=FoundLyrics(provider=LyricsProvider.LRCLIB, text=PLAIN_LYRICS)
                )
            case "Refused":
                return Enriched(status=EnrichStatus.REFUSED, message="HTTP Error 403.")
            case "Down":
                message = "LRCLIB couldn't be reached."
                raise NetworkError(message)
        site = LyricsProvider.NETEASE if title == "Elsewhere" else LyricsProvider.LRCLIB
        return Enriched(lyrics=FoundLyrics(provider=site, text=lyrics_of(title)))

    def find(self, request: FindLyrics) -> FoundLyricsOptions:
        """Answer the songs titled as asked: the song, then a live take; none for *Nowhere*.

        NetEase, once turned on, adds its own; *Refused* is refused.
        """
        match request.title:
            case "Nowhere":
                return FoundLyricsOptions()
            case "Refused":
                return FoundLyricsOptions(status=FindStatus.REFUSED, message="HTTP Error 403.")
        song = LyricsOption(
            provider=LyricsProvider.LRCLIB,
            title=request.title,
            artist=request.artist,
            duration_ms=request.duration_ms,
            text=lyrics_of(request.title),
        )
        live = song.model_copy(
            update={"title": f"{request.title} (Live)", "duration_ms": None, "text": PLAIN_LYRICS}
        )
        elsewhere = song.model_copy(update={"provider": LyricsProvider.NETEASE})
        on_netease = (elsewhere,) if LyricsProvider.NETEASE in request.sites else ()
        return FoundLyricsOptions(options=(song, live, *on_netease))


def register(registry: Registry) -> None:
    """Add the enrichers `bilibili-details`, `musicbrainz`, and `ai-details`, and the rest.

    The rest are two artist finders, an artist chooser and describer, a cover finder and
    chooser, and an image suggester and fetcher.
    """
    registry.add(TRACK_ENRICHER, "bilibili-details", Reader())
    registry.add(TRACK_ENRICHER, "musicbrainz", Finder())
    registry.add(TRACK_ENRICHER, "ai-details", Suggester())
    lyricist = Lyricist()
    registry.add(TRACK_ENRICHER, "lyrics", lyricist)
    registry.add(LYRICS_FINDER, "lyrics", lyricist)
    registry.add(ARTIST_FINDER, "musicbrainz", Artists())
    registry.add(ARTIST_NAME_FINDER, "wikipedia", ArtistNames())
    registry.add(ARTIST_CHOOSER, "ai-details", ArtistChoices())
    registry.add(ARTIST_DESCRIBER, "ai-details", ArtistDescriptions())
    registry.add(COVER_FINDER, "musicbrainz", Covers())
    registry.add(PICTURE_FINDER, "deezer", Pictures())
    registry.add(PICTURE_CHOOSER, "ai-details", PictureChoices())
    registry.add(COVER_CHOOSER, "ai-details", CoverChoices())
    registry.add(LYRICS_CHOOSER, "ai-details", LyricsChoices())
    registry.add(IMAGE_SUGGESTER, "ai-details", ImageLinks())
    registry.add(IMAGE_FETCHER, "ai-details", Images())


plugin = Plugin(api_version=1, register=register)
