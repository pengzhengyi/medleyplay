"""A song's lyrics: looked up as it comes up, kept per source, the household's first.

The reader test plugin answers the `lyrics` enricher by the song's title, as its table
says; no test contacts a site.
"""

from collections.abc import Iterator
from datetime import timedelta
from pathlib import Path

import pytest
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.accounts import AccountService
from medleyplay.application.segments import SongsService
from medleyplay.application.settings import SettingsService
from medleyplay.domain.accounts import Account
from medleyplay.domain.catalog import TrackId
from medleyplay.domain.details import Origin
from medleyplay.domain.enrichers import LYRICS, EnricherMode
from medleyplay.domain.errors import ConflictError, InvalidInputError
from medleyplay.domain.jobs import JobState, JobView
from medleyplay.domain.lyrics import Line, LyricsOrigin, LyricsSite
from medleyplay.domain.segments import SongRow
from medleyplay.domain.settings import Settings
from medleyplay.domain.video_text import Song
from tests.support.enrichment import Enriching, running_enrichment
from tests.support.factories import NewAccountFactory
from tests.support.fakes import FakeClock
from tests.support.plugins.reader import PLAIN_LYRICS

OWN = """\
[00:02.00]My own words
"""


@pytest.fixture
def alice(accounts: AccountService) -> Account:
    return accounts.create_first_admin(NewAccountFactory.admin()).account


@pytest.fixture
def enriching(
    units: sessionmaker[Session], clock: FakeClock, tmp_path: Path
) -> Iterator[Enriching]:
    with running_enrichment(units, clock, tmp_path / "data") as running:
        yield running


def _looked_up(
    enriching: Enriching, who: Account, track_id: TrackId, *, again: bool = False
) -> JobView:
    """Look the song's lyrics up, and wait for the Job to end."""
    job = enriching.enrichment.find_details(who, track_id, LYRICS.name, again=again)
    enriching.finish_every_job()
    return enriching.jobs.get_job(job.id)


def test_a_songs_lyrics_are_looked_up_and_shown_line_by_line(
    enriching: Enriching, alice: Account
) -> None:
    song = enriching.add_song("Let Down")

    _looked_up(enriching, alice, song)

    shown = enriching.lyrics.lyrics(song)
    assert shown is not None
    assert shown.origin is LyricsOrigin.LRCLIB
    assert shown.lyrics.lines == (Line(1_000, "Let Down"), Line(5_500, "la la la"))


def test_plain_lyrics_are_shown_as_written(enriching: Enriching, alice: Account) -> None:
    song = enriching.add_song("Plain")

    _looked_up(enriching, alice, song)

    shown = enriching.lyrics.lyrics(song)
    assert shown is not None
    assert (shown.lyrics.synced, shown.lyrics.plain) == (False, PLAIN_LYRICS)


def test_an_instrumental_has_no_lyrics_and_is_not_looked_up_again(
    enriching: Enriching, alice: Account
) -> None:
    song = enriching.add_song("Instrumental")

    _looked_up(enriching, alice, song)

    shown = enriching.lyrics.lyrics(song)
    assert shown is not None
    assert shown.instrumental
    with pytest.raises(ConflictError, match="has lyrics already"):
        enriching.enrichment.find_details(alice, song, LYRICS.name)


def test_a_song_whose_lyrics_were_not_found_is_looked_up_again_a_month_later(
    enriching: Enriching, alice: Account
) -> None:
    song = enriching.add_song("Nowhere")
    _looked_up(enriching, alice, song)

    with pytest.raises(ConflictError, match="last 30 days"):
        enriching.enrichment.find_details(alice, song, LYRICS.name)
    enriching.clock.advance(timedelta(days=30))

    assert _looked_up(enriching, alice, song).job.state is JobState.SUCCEEDED
    assert enriching.lyrics.lyrics(song) is None


def test_a_song_lrclib_lacks_is_looked_up_on_netease_at_once_when_it_is_turned_on(
    enriching: Enriching, alice: Account
) -> None:
    song = enriching.add_song("Elsewhere")
    _looked_up(enriching, alice, song)
    settings = SettingsService(enriching.units, enriching.clock)

    settings.put(alice, Settings(lyrics_sites=(LyricsSite.NETEASE,)))
    _looked_up(enriching, alice, song)

    shown = enriching.lyrics.lyrics(song)
    assert shown is not None
    assert shown.origin is LyricsOrigin.NETEASE
    assert shown.lyrics.lines[0] == Line(1_000, "Elsewhere")


def test_lyrics_found_before_are_looked_up_again_when_asked(
    enriching: Enriching, alice: Account
) -> None:
    song = enriching.add_song("Let Down")
    _looked_up(enriching, alice, song)

    again = _looked_up(enriching, alice, song, again=True)

    assert again.job.state is JobState.SUCCEEDED


def test_the_households_lyrics_show_first_and_are_never_looked_up(
    enriching: Enriching, alice: Account
) -> None:
    song = enriching.add_song("Let Down")
    _looked_up(enriching, alice, song)

    enriching.lyrics.set_own(song, OWN)

    shown = enriching.lyrics.lyrics(song)
    assert shown is not None
    assert (shown.origin, shown.lyrics.lines) == (
        LyricsOrigin.HOUSEHOLD,
        (Line(2_000, "My own words"),),
    )
    with pytest.raises(ConflictError, match="has lyrics already"):
        enriching.enrichment.find_details(alice, song, LYRICS.name, again=True)


def test_dropping_the_households_lyrics_shows_those_found_again(
    enriching: Enriching, alice: Account
) -> None:
    song = enriching.add_song("Let Down")
    _looked_up(enriching, alice, song)
    enriching.lyrics.set_own(song, OWN)

    shown = enriching.lyrics.forget_own(song)

    assert shown is not None
    assert shown.origin is LyricsOrigin.LRCLIB


def test_a_song_no_site_has_shows_the_nearest_songs_lyrics_as_suggested(
    enriching: Enriching, alice: Account
) -> None:
    song = enriching.add_song("Nearly")

    _looked_up(enriching, alice, song)

    shown = enriching.lyrics.lyrics(song)
    assert shown is not None
    assert shown.origin is LyricsOrigin.SUGGESTED
    assert shown.lyrics.lines[0] == Line(1_000, "Nearly")


def test_a_song_no_site_has_shows_none_while_suggestions_are_turned_off(
    enriching: Enriching, alice: Account
) -> None:
    song = enriching.add_song("Nearly")
    SettingsService(enriching.units, enriching.clock).put(alice, Settings(suggest_lyrics=False))

    _looked_up(enriching, alice, song)

    assert enriching.lyrics.lyrics(song) is None


def test_a_dismissed_suggestion_shows_no_more(enriching: Enriching, alice: Account) -> None:
    song = enriching.add_song("Nearly")
    _looked_up(enriching, alice, song)

    shown = enriching.lyrics.dismiss_suggestion(song)

    assert shown is None
    assert enriching.lyrics.lyrics(song) is None


def test_a_dismissed_suggestion_stays_dismissed_when_found_again(
    enriching: Enriching, alice: Account
) -> None:
    song = enriching.add_song("Nearly")
    _looked_up(enriching, alice, song)
    enriching.lyrics.dismiss_suggestion(song)

    _looked_up(enriching, alice, song, again=True)

    assert enriching.lyrics.lyrics(song) is None


def test_lyrics_a_site_has_for_the_song_replace_its_suggestion(
    enriching: Enriching, alice: Account
) -> None:
    song = enriching.add_song("Nearly")
    _looked_up(enriching, alice, song)
    SettingsService(enriching.units, enriching.clock).put(
        alice, Settings(lyrics_sites=(LyricsSite.NETEASE,))
    )

    _looked_up(enriching, alice, song, again=True)

    shown = enriching.lyrics.lyrics(song)
    assert shown is not None
    assert shown.origin is LyricsOrigin.NETEASE
    assert enriching.lyrics.dismiss_suggestion(song) == shown


def test_the_households_own_lyrics_replace_a_suggestion(
    enriching: Enriching, alice: Account
) -> None:
    song = enriching.add_song("Nearly")
    _looked_up(enriching, alice, song)
    enriching.lyrics.set_own(song, OWN)

    shown = enriching.lyrics.forget_own(song)

    assert shown is None


def test_the_household_may_say_a_song_is_instrumental(enriching: Enriching) -> None:
    song = enriching.add_song("Let Down")

    shown = enriching.lyrics.set_own(song, "", instrumental=True)

    assert (shown.origin, shown.instrumental) == (LyricsOrigin.HOUSEHOLD, True)


def test_empty_lyrics_of_the_households_are_refused(enriching: Enriching) -> None:
    song = enriching.add_song("Let Down")

    with pytest.raises(InvalidInputError):
        enriching.lyrics.set_own(song, "  \n")


def test_the_site_refusing_stops_looking_lyrics_up(enriching: Enriching, alice: Account) -> None:
    song = enriching.add_song("Refused")

    job = _looked_up(enriching, alice, song)

    assert job.job.state is JobState.FAILED
    assert enriching.enrichment.state(LYRICS.name).stopped_at is not None


def test_a_whole_album_has_no_lyrics_to_look_up(enriching: Enriching, alice: Account) -> None:
    album = enriching.add_song("Bremen", album="Bremen", duration_ms=3_600_000)

    with pytest.raises(ConflictError, match="whole album"):
        enriching.enrichment.find_details(alice, album, LYRICS.name)


def test_a_song_inside_a_longer_file_is_looked_up_by_its_own_title(
    enriching: Enriching, alice: Account
) -> None:
    album = enriching.add_song("Bremen", album="Bremen", origin=Origin.VIDEO, duration_ms=3_600_000)
    view = SongsService(enriching.units, enriching.clock).save(
        album,
        [
            SongRow(None, Song(0, "アイネクライネ", "米津玄師")),
            SongRow(None, Song(252_000, "Last")),
        ],
    )
    first = TrackId(view.songs[0].track_id)

    _looked_up(enriching, alice, first)

    shown = enriching.lyrics.lyrics(first)
    assert shown is not None
    assert shown.lyrics.lines[0] == Line(1_000, "アイネクライネ")


def test_lyrics_are_looked_up_as_songs_come_up_until_chosen_otherwise(
    enriching: Enriching, alice: Account
) -> None:
    assert enriching.enrichment.state(LYRICS.name).mode is EnricherMode.NEXT

    with pytest.raises(InvalidInputError):
        enriching.enrichment.set_mode(alice, LYRICS.name, EnricherMode.ALL)
