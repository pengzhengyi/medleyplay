"""LRCLIB is asked first, and NetEase after it only when the household turned it on.

Every request goes to a fake transport: no test contacts lrclib.net or music.163.com.
"""

from medleyplay.plugin_api import (
    EnrichStatus,
    EnrichTrack,
    FindLyrics,
    LyricsProvider,
    ShownDetail,
)
from medleyplay.plugins.lyrics import LyricsSites, lrclib, netease
from medleyplay.plugins.lyrics.lrclib import Lrclib
from medleyplay.plugins.lyrics.netease import Netease
from tests.support.transport import FakeTransport, FakeWaits, Reply

MELT = "[00:12.34]朝目が覚めて\n"


def asking_for_melt(*sites: LyricsProvider) -> EnrichTrack:
    """Ask about *Melt* by ryo, 4:20 long, with `sites` turned on after LRCLIB."""
    shown = (
        ShownDetail(field="title", value="Melt", origin="files"),
        ShownDetail(field="artist", value="ryo", origin="files"),
    )
    return EnrichTrack(shown=shown, duration_ms=260_000, folder="/unused", lyrics_sites=sites)


def lrclib_without_melt() -> FakeTransport:
    """LRCLIB, knowing no *Melt*."""
    return (
        FakeTransport()
        .answer(lrclib.GET, Reply.json({"code": 404}, status=404))
        .answer(lrclib.SEARCH, Reply.json([]))
    )


def netease_with_melt() -> FakeTransport:
    """NetEase, holding *Melt*'s timed lyrics."""
    song = {"id": 7, "name": "Melt", "artists": [{"name": "ryo"}], "duration": 260_000}
    return (
        FakeTransport()
        .answer(netease.SEARCH, Reply.json({"result": {"songs": [song]}, "code": 200}))
        .answer(netease.LYRIC, Reply.json({"lrc": {"lyric": MELT}, "code": 200}))
    )


def sites_of(at_lrclib: FakeTransport, at_netease: FakeTransport) -> LyricsSites:
    waits = FakeWaits()
    return LyricsSites(
        Lrclib(at_lrclib.session(), sleep=waits.sleep, clock=waits.clock),
        Netease(at_netease.session(), sleep=waits.sleep, clock=waits.clock),
    )


def test_netease_is_never_asked_unless_the_household_turned_it_on() -> None:
    at_netease = netease_with_melt()

    found = sites_of(lrclib_without_melt(), at_netease).enrich(asking_for_melt())

    assert found.lyrics is None
    assert at_netease.urls() == []


def test_netease_is_asked_when_lrclib_has_no_lyrics() -> None:
    found = sites_of(lrclib_without_melt(), netease_with_melt()).enrich(
        asking_for_melt(LyricsProvider.NETEASE)
    )

    assert found.lyrics is not None
    assert (found.lyrics.provider, found.lyrics.text) == (LyricsProvider.NETEASE, MELT)


def test_netease_is_not_asked_when_lrclib_has_lyrics() -> None:
    record = {"trackName": "Melt", "artistName": "ryo", "duration": 260, "syncedLyrics": MELT}
    at_lrclib = FakeTransport().answer(lrclib.GET, Reply.json(record))
    at_netease = netease_with_melt()

    found = sites_of(at_lrclib, at_netease).enrich(asking_for_melt(LyricsProvider.NETEASE))

    assert found.lyrics is not None
    assert found.lyrics.provider is LyricsProvider.LRCLIB
    assert at_netease.urls() == []


def test_a_refusal_from_lrclib_is_answered_without_asking_netease() -> None:
    at_lrclib = FakeTransport().answer(lrclib.GET, Reply.json({}, status=403))
    at_netease = netease_with_melt()

    found = sites_of(at_lrclib, at_netease).enrich(asking_for_melt(LyricsProvider.NETEASE))

    assert found.status is EnrichStatus.REFUSED
    assert at_netease.urls() == []


def lrclib_finding_melt() -> FakeTransport:
    """LRCLIB, whose search finds *Melt*."""
    record = {"trackName": "Melt", "artistName": "ryo", "duration": 260.0, "syncedLyrics": MELT}
    return FakeTransport().answer(lrclib.SEARCH, Reply.json([record]))


def test_lyrics_are_found_on_lrclib_then_on_the_sites_turned_on() -> None:
    lrclib_fake, netease_fake = lrclib_finding_melt(), netease_with_melt()
    sites = sites_of(lrclib_fake, netease_fake)

    found = sites.find(FindLyrics(title="Melt", artist="ryo", sites=(LyricsProvider.NETEASE,)))

    assert [each.provider for each in found.options] == [
        LyricsProvider.LRCLIB,
        LyricsProvider.NETEASE,
    ]


def test_netease_is_not_searched_unless_turned_on() -> None:
    lrclib_fake, netease_fake = lrclib_finding_melt(), netease_with_melt()
    sites = sites_of(lrclib_fake, netease_fake)

    found = sites.find(FindLyrics(title="Melt", artist="ryo"))

    assert [each.provider for each in found.options] == [LyricsProvider.LRCLIB]
    assert netease_fake.sent == []
