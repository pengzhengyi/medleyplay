"""LRCLIB is asked politely for a song's lyrics, and what it answers is read with care.

Every request goes to a fake transport: no test contacts lrclib.net.
"""

from importlib.metadata import version

import pytest

from medleyplay.plugin_api import (
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
from medleyplay.plugins.lyrics.lrclib import (
    GET,
    MAX_ATTEMPTS,
    MAX_OFFERED,
    SEARCH,
    USER_AGENT,
    Lrclib,
)
from tests.support.transport import FakeTransport, FakeWaits, Reply

MELT = """\
[00:12.34]朝目が覚めて
[00:15.50]真っ先に思い浮かぶ
"""


def melt(**changes: object) -> dict[str, object]:
    """LRCLIB's record of *Melt* by ryo, 4:20 long, with timed and plain lyrics."""
    return {
        "id": 3396226,
        "trackName": "Melt",
        "artistName": "ryo",
        "albumName": "Re:Start",
        "duration": 260.0,
        "instrumental": False,
        "plainLyrics": "朝目が覚めて\n真っ先に思い浮かぶ",
        "syncedLyrics": MELT,
        **changes,
    }


def asking_for_melt(duration_ms: int | None = 260_400) -> EnrichTrack:
    """Ask about *Melt* by ryo on *Re:Start*, as long as the file is."""
    shown = (
        ShownDetail(field="title", value="Melt", origin="files"),
        ShownDetail(field="artist", value="ryo", origin="files"),
        ShownDetail(field="album", value="Re:Start", origin="files"),
    )
    return EnrichTrack(shown=shown, duration_ms=duration_ms, folder="/unused")


def lrclib_of(fake: FakeTransport, waits: FakeWaits | None = None) -> Lrclib:
    waits = waits or FakeWaits()
    return Lrclib(fake.session(), sleep=waits.sleep, clock=waits.clock)


def test_a_song_is_asked_for_by_its_title_artist_album_and_length_in_seconds() -> None:
    fake = FakeTransport().answer(GET, Reply.json(melt()))

    found = lrclib_of(fake).enrich(asking_for_melt())

    assert found.lyrics == FoundLyrics(provider=LyricsProvider.LRCLIB, text=MELT)
    assert [fake.parameter(name) for name in ("track_name", "artist_name", "album_name")] == [
        "Melt",
        "ryo",
        "Re:Start",
    ]
    assert fake.parameter("duration") == "260"


def test_the_user_agent_names_medleyplay_its_version_and_where_to_reach_it() -> None:
    fake = FakeTransport().answer(GET, Reply.json(melt()))

    lrclib_of(fake).enrich(asking_for_melt())

    assert fake.sent[0].headers["User-Agent"] == USER_AGENT
    assert version("medleyplay") in USER_AGENT
    assert fake.timeouts[0] is not None


def test_plain_lyrics_are_answered_when_none_are_timed() -> None:
    fake = FakeTransport().answer(GET, Reply.json(melt(syncedLyrics=None)))

    found = lrclib_of(fake).enrich(asking_for_melt())

    assert found.lyrics is not None
    assert found.lyrics.text == "朝目が覚めて\n真っ先に思い浮かぶ"


def test_an_instrumental_is_answered_as_one() -> None:
    record = melt(instrumental=True, plainLyrics=None, syncedLyrics=None)
    fake = FakeTransport().answer(GET, Reply.json(record))

    found = lrclib_of(fake).enrich(asking_for_melt())

    assert found.lyrics == FoundLyrics(provider=LyricsProvider.LRCLIB, instrumental=True)


def test_a_song_not_found_by_its_album_is_searched_for_within_two_seconds_of_its_length() -> None:
    fake = (
        FakeTransport()
        .answer(GET, Reply.json({"code": 404}, status=404))
        .answer(SEARCH, Reply.json([melt(duration=300.0, syncedLyrics="[00:01.00]x"), melt()]))
    )

    found = lrclib_of(fake).enrich(asking_for_melt())

    assert found.lyrics is not None
    assert found.lyrics.text == MELT
    assert fake.urls() == [GET, SEARCH]


def test_a_song_found_nowhere_has_no_lyrics() -> None:
    fake = (
        FakeTransport()
        .answer(GET, Reply.json({"code": 404}, status=404))
        .answer(SEARCH, Reply.json([melt(duration=300.0)]))
    )

    found = lrclib_of(fake).enrich(asking_for_melt())

    assert (found.status, found.lyrics) == (EnrichStatus.OK, None)


def test_a_song_of_no_known_length_is_searched_for_by_its_exact_words() -> None:
    fake = FakeTransport().answer(
        SEARCH, Reply.json([melt(trackName="Melt (Remix)"), melt(trackName="melt")])
    )

    found = lrclib_of(fake).enrich(asking_for_melt(duration_ms=None))

    assert found.lyrics is not None
    assert fake.urls() == [SEARCH]


def test_lrclib_refusing_is_a_refusal() -> None:
    fake = FakeTransport().answer(GET, Reply(403))

    found = lrclib_of(fake).enrich(asking_for_melt())

    assert found.status is EnrichStatus.REFUSED


def test_a_request_lrclib_finds_wrong_is_invalid() -> None:
    fake = FakeTransport().answer(GET, Reply(400))

    found = lrclib_of(fake).enrich(asking_for_melt())

    assert found.status is EnrichStatus.INVALID


def test_lrclib_busy_is_waited_out_as_it_asks_then_tried_again() -> None:
    waits = FakeWaits()
    fake = FakeTransport().answer(GET, Reply(429, {"Retry-After": "3"}), Reply.json(melt()))

    found = lrclib_of(fake, waits).enrich(asking_for_melt())

    assert found.lyrics is not None
    assert any(3 <= pause <= 3 * 1.3 for pause in waits.pauses)


def test_lrclib_busy_too_long_or_down_is_a_network_failure() -> None:
    fake = FakeTransport().answer(GET, Reply(503, {"Retry-After": "3"}))

    with pytest.raises(NetworkError):
        lrclib_of(fake).enrich(asking_for_melt())

    assert len(fake.sent) == MAX_ATTEMPTS


def test_lyrics_answered_in_another_shape_are_invalid() -> None:
    fake = FakeTransport().answer(GET, Reply.json(["not", "a", "record"]))

    found = lrclib_of(fake).enrich(asking_for_melt())

    assert found.status is EnrichStatus.INVALID


def finding_melt(duration_ms: int | None = 260_400) -> FindLyrics:
    """Find the songs titled *Melt* by ryo, as long as the file is."""
    return FindLyrics(title="Melt", artist="ryo", duration_ms=duration_ms)


def test_the_songs_found_by_title_and_artist_are_offered_closest_in_length_first() -> None:
    acoustic = melt(id=2, trackName="Melt (Acoustic)", duration=291.0, syncedLyrics=None)
    fake = FakeTransport().answer(SEARCH, Reply.json([acoustic, melt()]))

    found = lrclib_of(fake).find(finding_melt())

    assert found.options == (
        LyricsOption(
            provider=LyricsProvider.LRCLIB,
            title="Melt",
            artist="ryo",
            album="Re:Start",
            duration_ms=260_000,
            text=MELT,
        ),
        LyricsOption(
            provider=LyricsProvider.LRCLIB,
            title="Melt (Acoustic)",
            artist="ryo",
            album="Re:Start",
            duration_ms=291_000,
            text="朝目が覚めて\n真っ先に思い浮かぶ",
        ),
    )
    assert (fake.parameter("track_name"), fake.parameter("artist_name")) == ("Melt", "ryo")


def test_a_song_found_with_no_lyrics_is_not_offered_and_an_instrumental_is() -> None:
    wordless = melt(id=2, plainLyrics=None, syncedLyrics=None)
    instrumental = melt(id=3, trackName="Melt (Off Vocal)", instrumental=True, syncedLyrics=None)
    fake = FakeTransport().answer(SEARCH, Reply.json([wordless, instrumental]))

    found = lrclib_of(fake).find(finding_melt())

    assert [(each.title, each.instrumental) for each in found.options] == [
        ("Melt (Off Vocal)", True)
    ]


def test_a_song_of_no_known_length_keeps_the_order_lrclib_found_its_songs_in() -> None:
    first, second = melt(id=1, trackName="Melt A"), melt(id=2, trackName="Melt B", duration=10.0)
    fake = FakeTransport().answer(SEARCH, Reply.json([first, second]))

    found = lrclib_of(fake).find(finding_melt(duration_ms=None))

    assert [each.title for each in found.options] == ["Melt A", "Melt B"]


def test_at_most_a_few_songs_are_offered_from_lrclib() -> None:
    many = [melt(id=at, trackName=f"Melt {at}") for at in range(MAX_OFFERED + 3)]
    fake = FakeTransport().answer(SEARCH, Reply.json(many))

    found = lrclib_of(fake).find(finding_melt())

    assert len(found.options) == MAX_OFFERED


def test_lrclib_refusing_a_search_is_a_refusal() -> None:
    fake = FakeTransport().answer(SEARCH, Reply.json({"code": 403}, status=403))

    found = lrclib_of(fake).find(finding_melt())

    assert found.status is FindStatus.REFUSED
    assert found.options == ()
