"""NetEase Cloud Music is asked for a song's lyrics through its plain endpoints only.

Every request goes to a fake transport: no test contacts music.163.com.
"""

import pytest
import requests

from medleyplay.plugin_api import (
    MAX_LYRICS,
    EnrichStatus,
    EnrichTrack,
    FindLyrics,
    FindStatus,
    FoundLyrics,
    LyricsOption,
    LyricsProvider,
    NetworkError,
    ShownDetail,
)
from medleyplay.plugins.lyrics.lrclib import USER_AGENT
from medleyplay.plugins.lyrics.netease import LYRIC, MAX_OFFERED, SEARCH, SPACING, Netease
from tests.support.transport import FakeTransport, FakeWaits, Reply

MELT = """\
[00:12.34]朝目が覚めて
[00:15.50]真っ先に思い浮かぶ
"""

MELT_IN_CHINESE = """\
[by:译者]
[00:12.34]早上醒来
[00:15.50]第一个想到的
"""


def melt(**changes: object) -> dict[str, object]:
    """NetEase's record of *Melt* by ryo, 4:20 long, as its search lists it."""
    return {
        "id": 22677433,
        "name": "Melt",
        "artists": [{"id": 16152, "name": "ryo"}],
        "album": {"id": 2083032, "name": "Re:Start"},
        "duration": 260_000,
        **changes,
    }


def searched(*songs: dict[str, object]) -> Reply:
    """NetEase's search answering `songs`."""
    return Reply.json({"result": {"songs": list(songs), "songCount": len(songs)}, "code": 200})


def lyric(text: str = MELT, translation: str = "", **flags: object) -> Reply:
    """NetEase's lyrics of a song: its LRC, a translation, and flags such as `nolyric`."""
    return Reply.json(
        {"lrc": {"version": 7, "lyric": text}, "tlyric": {"version": 1, "lyric": translation}}
        | flags
        | {"code": 200}
    )


def asking_for_melt(duration_ms: int | None = 260_400, **shown: str) -> EnrichTrack:
    """Ask about *Melt* by ryo, as long as the file is."""
    named = {"title": "Melt", "artist": "ryo"} | shown
    return EnrichTrack(
        shown=tuple(
            ShownDetail(field=field, value=value, origin="files") for field, value in named.items()
        ),
        duration_ms=duration_ms,
        folder="/unused",
    )


def netease_of(fake: FakeTransport, waits: FakeWaits | None = None) -> Netease:
    waits = waits or FakeWaits()
    return Netease(fake.session(), sleep=waits.sleep, clock=waits.clock)


def test_a_song_is_searched_for_by_title_and_artist_then_its_lyrics_read_by_id() -> None:
    fake = FakeTransport().answer(SEARCH, searched(melt())).answer(LYRIC, lyric())

    found = netease_of(fake).enrich(asking_for_melt())

    assert found.lyrics == FoundLyrics(provider=LyricsProvider.NETEASE, text=MELT)
    assert fake.urls() == [SEARCH, LYRIC]
    assert (fake.parameter("s"), fake.parameter("type")) == ("Melt ryo", "1")
    assert fake.parameter("id", 1) == "22677433"


def test_only_plain_get_requests_are_sent_naming_medleyplay() -> None:
    fake = FakeTransport().answer(SEARCH, searched(melt())).answer(LYRIC, lyric())

    netease_of(fake).enrich(asking_for_melt())

    assert [each.method for each in fake.sent] == ["GET", "GET"]
    assert all(each.headers["User-Agent"] == USER_AGENT for each in fake.sent)
    assert all(timeout is not None for timeout in fake.timeouts)


def test_requests_are_a_second_apart() -> None:
    waits = FakeWaits()
    fake = FakeTransport().answer(SEARCH, searched(melt())).answer(LYRIC, lyric())

    netease_of(fake, waits).enrich(asking_for_melt())

    assert waits.pauses == [SPACING]


def test_the_first_result_of_the_songs_title_within_two_seconds_of_its_length_is_taken() -> None:
    fake = (
        FakeTransport()
        .answer(
            SEARCH,
            searched(
                melt(id=1, duration=300_000),
                melt(id=2, name="Melt (Live)"),
                melt(id=3, name="ＭＥＬＴ", duration=261_500),  # noqa: RUF001 -- full width, as typed; cspell:disable-line
            ),
        )
        .answer(LYRIC, lyric())
    )

    netease_of(fake).enrich(asking_for_melt())

    assert fake.parameter("id", 1) == "3"


def test_a_song_of_no_known_length_is_taken_by_its_title_and_an_artist() -> None:
    fake = (
        FakeTransport()
        .answer(
            SEARCH,
            searched(melt(id=1, artists=[{"name": "supercell"}]), melt(id=2, duration=1_000)),
        )
        .answer(LYRIC, lyric())
    )

    netease_of(fake).enrich(asking_for_melt(duration_ms=None))

    assert fake.parameter("id", 1) == "2"


def test_a_song_not_found_has_no_lyrics() -> None:
    fake = FakeTransport().answer(SEARCH, Reply.json({"result": {"songCount": 0}, "code": 200}))

    found = netease_of(fake).enrich(asking_for_melt())

    assert found.status is EnrichStatus.OK
    assert found.lyrics is None
    assert fake.urls() == [SEARCH]


def test_a_song_found_without_lyrics_has_none() -> None:
    fake = (
        FakeTransport()
        .answer(SEARCH, searched(melt()))
        .answer(LYRIC, Reply.json({"uncollected": True, "code": 200}))
    )

    found = netease_of(fake).enrich(asking_for_melt())

    assert found.lyrics is None


@pytest.mark.parametrize(
    "reply",
    [
        lyric("", nolyric=True),
        lyric("", pureMusic=True),
        lyric("[00:00.00] 纯音乐，请欣赏\n"),  # noqa: RUF001 -- NetEase's own words
    ],
    ids=["no lyric", "pure music", "pure music in words"],
)
def test_an_instrumental_is_answered_as_one(reply: Reply) -> None:
    fake = FakeTransport().answer(SEARCH, searched(melt())).answer(LYRIC, reply)

    found = netease_of(fake).enrich(asking_for_melt())

    assert found.lyrics == FoundLyrics(provider=LyricsProvider.NETEASE, instrumental=True)


def test_a_translation_follows_the_lyrics_each_line_at_the_time_of_its_own() -> None:
    fake = (
        FakeTransport()
        .answer(SEARCH, searched(melt()))
        .answer(LYRIC, lyric(translation=MELT_IN_CHINESE))
    )

    found = netease_of(fake).enrich(asking_for_melt())

    assert found.lyrics is not None
    assert found.lyrics.text == MELT + MELT_IN_CHINESE


def test_lyrics_too_long_with_their_translation_are_answered_without_it() -> None:
    long = "[00:01.00]" + "あ" * (MAX_LYRICS - 20) + "\n"
    fake = (
        FakeTransport()
        .answer(SEARCH, searched(melt()))
        .answer(LYRIC, lyric(long, translation=MELT_IN_CHINESE))
    )

    found = netease_of(fake).enrich(asking_for_melt())

    assert found.lyrics is not None
    assert found.lyrics.text == long


def test_lyrics_too_long_are_none() -> None:
    long = "[00:01.00]" + "あ" * MAX_LYRICS + "\n"
    fake = FakeTransport().answer(SEARCH, searched(melt())).answer(LYRIC, lyric(long))

    found = netease_of(fake).enrich(asking_for_melt())

    assert found.lyrics is None


def test_a_whole_album_or_a_song_without_an_artist_is_not_asked_about() -> None:
    fake = FakeTransport()
    album = asking_for_melt().model_copy(update={"whole_album": True})
    no_artist = asking_for_melt(artist="")

    answers = [netease_of(fake).enrich(album), netease_of(fake).enrich(no_artist)]

    assert [each.lyrics for each in answers] == [None, None]
    assert fake.urls() == []


@pytest.mark.parametrize(
    "reply",
    [Reply.json({}, status=403), Reply.json({"code": -460, "message": "Cheating"})],
    ids=["HTTP 403", "code -460"],
)
def test_a_refusal_stops_the_enricher_and_is_not_worked_around(reply: Reply) -> None:
    fake = FakeTransport().answer(SEARCH, reply)

    found = netease_of(fake).enrich(asking_for_melt())

    assert found.status is EnrichStatus.REFUSED
    assert "NetEase" in found.message
    assert fake.urls() == [SEARCH]


@pytest.mark.parametrize(
    "reply",
    [
        Reply.json({}, status=429),
        Reply.json({}, status=503),
        Reply.json({"code": 405, "message": "操作频繁，请稍候再试"}),  # noqa: RUF001 -- NetEase's own words
    ],
    ids=["HTTP 429", "HTTP 503", "code 405"],
)
def test_a_busy_answer_fails_the_lookup_without_asking_again(reply: Reply) -> None:
    fake = FakeTransport().answer(SEARCH, reply)

    with pytest.raises(NetworkError, match="NetEase"):
        netease_of(fake).enrich(asking_for_melt())

    assert fake.urls() == [SEARCH]


@pytest.mark.parametrize(
    "reply",
    [
        Reply.json({}, status=400),
        Reply.json({"result": {"songs": "none"}, "code": 200}),
        Reply.json(["not", "a", "search"]),
    ],
    ids=["HTTP 400", "songs of another shape", "a list"],
)
def test_an_answer_of_another_shape_is_invalid(reply: Reply) -> None:
    fake = FakeTransport().answer(SEARCH, reply)

    found = netease_of(fake).enrich(asking_for_melt())

    assert found.status is EnrichStatus.INVALID


def test_an_unreachable_site_is_a_network_failure() -> None:
    fake = FakeTransport().answer(SEARCH, requests.ConnectionError("no route"))

    with pytest.raises(NetworkError, match="NetEase couldn't be reached"):
        netease_of(fake).enrich(asking_for_melt())


def test_the_songs_found_are_offered_with_their_lyrics_closest_in_length_first() -> None:
    live = melt(id=2, name="Melt (Live)", duration=301_000, album={"name": "Live"})
    fake = (
        FakeTransport()
        .answer(SEARCH, searched(live, melt()))
        .answer(LYRIC, lyric("[00:01.00]Live\n"), lyric())
    )

    found = netease_of(fake).find(FindLyrics(title="Melt", artist="ryo", duration_ms=260_400))

    assert found.options == (
        LyricsOption(
            provider=LyricsProvider.NETEASE,
            title="Melt",
            artist="ryo",
            album="Re:Start",
            duration_ms=260_000,
            text=MELT,
        ),
        LyricsOption(
            provider=LyricsProvider.NETEASE,
            title="Melt (Live)",
            artist="ryo",
            album="Live",
            duration_ms=301_000,
            text="[00:01.00]Live\n",
        ),
    )
    assert fake.parameter("s") == "Melt ryo"


def test_only_the_first_few_songs_found_are_asked_for_their_lyrics() -> None:
    songs = [melt(id=at, name=f"Melt {at}") for at in range(MAX_OFFERED + 2)]
    fake = (
        FakeTransport()
        .answer(SEARCH, searched(*songs))
        .answer(LYRIC, *[lyric() for _ in range(MAX_OFFERED)])
    )

    found = netease_of(fake).find(FindLyrics(title="Melt", artist="ryo"))

    assert len(found.options) == MAX_OFFERED
    assert sum(str(request.url).startswith(LYRIC) for request in fake.sent) == MAX_OFFERED


def test_netease_refusing_a_search_is_a_refusal() -> None:
    fake = FakeTransport().answer(SEARCH, Reply.json({"code": -460, "msg": "Cheating"}))

    found = netease_of(fake).find(FindLyrics(title="Melt", artist="ryo"))

    assert found.status is FindStatus.REFUSED
