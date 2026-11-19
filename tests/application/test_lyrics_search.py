"""Looking for a song's lyrics by hand: the songs the sites find of a title and artist.

Nothing changes the song's lyrics until the household chooses some; what is found is
kept for the song, and finding again replaces it.
"""

from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.accounts import AccountService
from medleyplay.application.lyrics_search import LyricsFound
from medleyplay.application.settings import SettingsService
from medleyplay.domain.accounts import Account
from medleyplay.domain.catalog import TrackId
from medleyplay.domain.errors import InvalidInputError, NotFoundError
from medleyplay.domain.lyrics import LyricsSite
from medleyplay.domain.settings import Settings
from medleyplay.plugin_api import LyricsProvider
from tests.support.enrichment import Enriching, running_enrichment
from tests.support.factories import NewAccountFactory
from tests.support.fakes import FakeClock
from tests.support.plugins.reader import PLAIN_LYRICS, lyrics_of


@pytest.fixture
def alice(accounts: AccountService) -> Account:
    return accounts.create_first_admin(NewAccountFactory.admin()).account


@pytest.fixture
def enriching(
    units: sessionmaker[Session], clock: FakeClock, tmp_path: Path
) -> Iterator[Enriching]:
    with running_enrichment(units, clock, tmp_path / "data") as running:
        yield running


def _found(
    enriching: Enriching, caller: Account, song: TrackId, title: str = "Melt", artist: str = "ryo"
) -> LyricsFound:
    """Have `caller` look for the lyrics of `title` by `artist`, and return what was found."""
    enriching.lyrics_search.find(caller, song, title, artist)
    enriching.finish_every_job()
    return enriching.lyrics_search.found(caller, song)


def test_the_songs_found_are_kept_with_their_lyrics_and_what_was_asked(
    enriching: Enriching, alice: Account
) -> None:
    song = enriching.add_song("【MV】Melt", artist="初音ミク", duration_ms=260_000)

    found = _found(enriching, alice, song)

    assert [(each.title, each.text) for each in found.options] == [
        ("Melt", lyrics_of("Melt")),
        ("Melt (Live)", PLAIN_LYRICS),
    ]
    assert found.options[0].duration_ms == 260_000
    assert (found.title, found.artist, found.finding, found.failure) == ("Melt", "ryo", False, None)
    assert found.found_at == enriching.clock()


def test_nothing_changes_the_songs_lyrics_until_some_are_chosen(
    enriching: Enriching, alice: Account
) -> None:
    song = enriching.add_song("Melt", artist="ryo")

    _found(enriching, alice, song)

    assert enriching.lyrics.lyrics(song) is None


def test_netease_is_searched_too_once_turned_on(enriching: Enriching, alice: Account) -> None:
    song = enriching.add_song("Melt", artist="ryo")
    SettingsService(enriching.units, enriching.clock).put(
        alice, Settings(lyrics_sites=(LyricsSite.NETEASE,))
    )

    found = _found(enriching, alice, song)

    assert [each.provider for each in found.options] == [
        LyricsProvider.LRCLIB,
        LyricsProvider.LRCLIB,
        LyricsProvider.NETEASE,
    ]


def test_finding_again_replaces_what_was_found(enriching: Enriching, alice: Account) -> None:
    song = enriching.add_song("Melt", artist="ryo")
    _found(enriching, alice, song)

    found = _found(enriching, alice, song, title="Nowhere")

    assert (found.title, found.options) == ("Nowhere", ())


def test_a_site_refusing_fails_the_finding_saying_so(enriching: Enriching, alice: Account) -> None:
    song = enriching.add_song("Melt", artist="ryo")

    found = _found(enriching, alice, song, title="Refused")

    assert found.options == ()
    assert found.failure is not None
    assert "403" in found.failure


def test_nothing_is_known_of_a_songs_lyrics_found_until_asked(
    enriching: Enriching, alice: Account
) -> None:
    song = enriching.add_song("Melt", artist="ryo")

    known = enriching.lyrics_search.found(alice, song)

    assert (known.options, known.found_at, known.finding, known.title) == ((), None, False, "")


def test_finding_needs_a_title(enriching: Enriching, alice: Account) -> None:
    song = enriching.add_song("Melt", artist="ryo")

    with pytest.raises(InvalidInputError, match="title"):
        enriching.lyrics_search.find(alice, song, "  ", "ryo")


def test_finding_the_lyrics_of_no_song_is_refused(enriching: Enriching, alice: Account) -> None:
    with pytest.raises(NotFoundError):
        enriching.lyrics_search.find(alice, TrackId(404), "Melt", "ryo")
