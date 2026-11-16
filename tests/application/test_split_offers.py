"""Split offers: long files a song list was found for, to split or keep, as *Split albums* says."""

from collections.abc import Callable, Iterator
from pathlib import Path

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.accounts import AccountService
from medleyplay.application.segments import SongsService
from medleyplay.application.settings import SettingsService
from medleyplay.application.split_offers import (
    AI_AT_ONCE,
    Chosen,
    OfferedFile,
    SplitOfferService,
)
from medleyplay.domain.accounts import Account
from medleyplay.domain.catalog import SourceKey, TrackDetails, TrackId
from medleyplay.domain.settings import Settings, SplitAlbums
from medleyplay.domain.split_offers import OfferSource
from medleyplay.domain.video_text import Chapter, VideoText
from medleyplay.persistence.schema import JobRow
from tests.support.ai import DEEPSEEK
from tests.support.enrichment import Enriching, running_enrichment
from tests.support.factories import NewAccountFactory
from tests.support.fakes import FakeClock

MINUTE = 60_000
NIGHT_DRIVE = (
    Chapter(0, "Intro"),
    Chapter(192_000, "Night Drive"),
    Chapter(4_060_000, "Outro"),
)
"""Three songs, as the video's chapters list them, and as the AI answers for *Album*."""
FOUR_SONGS = tuple(Chapter(start * 4 * MINUTE, f"Song {start + 1}") for start in range(4))
"""Four songs of four minutes each, as a 16-minute file's chapters list them."""


@pytest.fixture
def alice(accounts: AccountService) -> Account:
    return accounts.create_first_admin(NewAccountFactory.admin()).account


@pytest.fixture
def enriching(
    units: sessionmaker[Session], clock: FakeClock, tmp_path: Path, alice: Account
) -> Iterator[Enriching]:
    """The services around the `reader` plugin, with DeepSeek set up to ask."""
    with running_enrichment(units, clock, tmp_path / "data") as running:
        running.ai.add(alice, DEEPSEEK, "deepseek-flash", None)
        yield running


@pytest.fixture
def songs(units: sessionmaker[Session], clock: FakeClock) -> SongsService:
    return SongsService(units, clock)


@pytest.fixture
def offers(
    units: sessionmaker[Session], clock: FakeClock, songs: SongsService, enriching: Enriching
) -> SplitOfferService:
    return SplitOfferService(units, clock, songs, enriching.enrichment)


@pytest.fixture
def split_albums(
    units: sessionmaker[Session], clock: FakeClock, alice: Account
) -> Callable[[SplitAlbums], None]:
    """Have Alice choose what becomes of long files, with files 15 minutes long guessed albums."""
    service = SettingsService(units, clock)

    def choose(setting: SplitAlbums) -> None:
        settings = Settings(album_minutes=15, split_albums=setting, revision=service.get().revision)
        service.put(alice, settings)

    return choose


def _long_file(
    enriching: Enriching,
    title: str,
    *,
    minutes: int = 80,
    chapters: tuple[Chapter, ...] | None = None,
    text_title: str | None = None,
) -> TrackId:
    """Add a Library file `minutes` long; with `chapters` or `text_title`, its video's text too."""
    key = SourceKey("library", f"1/Music/{title}.m4a")
    track_id = enriching.catalog.add_track(
        key, TrackDetails(title=title, duration_ms=minutes * MINUTE)
    )
    if chapters is not None or text_title is not None:
        enriching.details.read_video_text(
            track_id, VideoText(text_title or title, "", chapters or ())
        )
    return track_id


def _offered(offers: SplitOfferService) -> dict[TrackId, OfferedFile]:
    return {each.track_id: each for each in offers.offers().files}


def _ai_jobs(enriching: Enriching) -> int:
    with enriching.units() as db:
        query = select(func.count()).select_from(JobRow).where(JobRow.target.like("%:ai-details"))
        return db.scalar(query) or 0


def test_a_long_file_is_offered_with_its_videos_list_and_left_as_one_until_chosen(
    enriching: Enriching,
    offers: SplitOfferService,
    songs: SongsService,
    split_albums: Callable[[SplitAlbums], None],
    alice: Account,
) -> None:
    split_albums(SplitAlbums.APPROVAL)
    album = _long_file(enriching, "Live", minutes=16, chapters=FOUR_SONGS)

    offered = _offered(offers)[album]

    assert offered.offer is not None
    assert (offered.offer.source, len(offered.offer.songs), offered.offer.trusted) == (
        OfferSource.VIDEO,
        4,
        True,
    )
    assert songs.songs(album).songs == ()


def test_nothing_is_offered_while_split_albums_is_off(
    enriching: Enriching,
    offers: SplitOfferService,
    split_albums: Callable[[SplitAlbums], None],
    alice: Account,
) -> None:
    split_albums(SplitAlbums.OFF)
    _long_file(enriching, "Live", minutes=16, chapters=FOUR_SONGS)

    assert offers.offers().files == ()


def test_a_file_shorter_than_an_album_is_not_offered(
    enriching: Enriching,
    offers: SplitOfferService,
    split_albums: Callable[[SplitAlbums], None],
    alice: Account,
) -> None:
    split_albums(SplitAlbums.APPROVAL)
    single = _long_file(enriching, "Single", minutes=4, chapters=FOUR_SONGS[:1])

    assert single not in _offered(offers)


def test_a_file_chosen_is_split_by_the_list_offered(
    enriching: Enriching,
    offers: SplitOfferService,
    songs: SongsService,
    split_albums: Callable[[SplitAlbums], None],
    alice: Account,
) -> None:
    split_albums(SplitAlbums.APPROVAL)
    album = _long_file(enriching, "Live", minutes=16, chapters=FOUR_SONGS)
    offer = _offered(offers)[album].offer
    assert offer is not None

    done = offers.split(alice, [Chosen(album, offer.signature)])

    assert (done.split, done.left) == (1, 0)
    assert [song.title for song in songs.songs(album).songs] == [
        "Song 1",
        "Song 2",
        "Song 3",
        "Song 4",
    ]
    assert album not in _offered(offers)


def test_a_file_whose_list_changed_since_it_was_shown_is_left_as_it_is(
    enriching: Enriching,
    offers: SplitOfferService,
    songs: SongsService,
    split_albums: Callable[[SplitAlbums], None],
    alice: Account,
) -> None:
    split_albums(SplitAlbums.APPROVAL)
    album = _long_file(enriching, "Live", minutes=16, chapters=FOUR_SONGS)

    done = offers.split(alice, [Chosen(album, "0,240000")])

    assert (done.split, done.left) == (0, 1)
    assert songs.songs(album).songs == ()


def test_a_file_kept_as_one_is_offered_no_more(
    enriching: Enriching,
    offers: SplitOfferService,
    split_albums: Callable[[SplitAlbums], None],
    alice: Account,
) -> None:
    split_albums(SplitAlbums.APPROVAL)
    album = _long_file(enriching, "Live", minutes=16, chapters=FOUR_SONGS)

    offers.keep(alice, [album])

    assert album not in _offered(offers)


def test_auto_splits_a_file_whose_list_is_trusted_and_offers_a_doubted_one(
    enriching: Enriching,
    offers: SplitOfferService,
    songs: SongsService,
    split_albums: Callable[[SplitAlbums], None],
    alice: Account,
) -> None:
    split_albums(SplitAlbums.AUTO)
    trusted = _long_file(enriching, "Live", minutes=16, chapters=FOUR_SONGS)
    doubted = _long_file(enriching, "Set", minutes=80, chapters=NIGHT_DRIVE)

    split = offers.auto_split()

    assert split == 1
    assert len(songs.songs(trusted).songs) == 4
    assert songs.songs(doubted).songs == ()
    assert doubted in _offered(offers)


def test_auto_splits_nothing_under_approval(
    enriching: Enriching,
    offers: SplitOfferService,
    songs: SongsService,
    split_albums: Callable[[SplitAlbums], None],
    alice: Account,
) -> None:
    split_albums(SplitAlbums.APPROVAL)
    album = _long_file(enriching, "Live", minutes=16, chapters=FOUR_SONGS)

    assert offers.auto_split() == 0
    assert songs.songs(album).songs == ()


def test_auto_never_splits_again_a_file_the_household_unsplit(
    enriching: Enriching,
    offers: SplitOfferService,
    songs: SongsService,
    split_albums: Callable[[SplitAlbums], None],
    alice: Account,
) -> None:
    split_albums(SplitAlbums.AUTO)
    album = _long_file(enriching, "Live", minutes=16, chapters=FOUR_SONGS)
    offers.auto_split()

    songs.unsplit(album)

    assert offers.auto_split() == 0
    assert songs.songs(album).songs == ()


def test_auto_asks_the_ai_once_for_the_list_of_a_file_with_text_and_none(
    enriching: Enriching,
    offers: SplitOfferService,
    split_albums: Callable[[SplitAlbums], None],
    alice: Account,
) -> None:
    split_albums(SplitAlbums.AUTO)
    album = _long_file(enriching, "Mixtape", text_title="Album")

    offers.auto_split()
    enriching.finish_every_job()
    offers.auto_split()
    enriching.finish_every_job()

    offered = _offered(offers)[album].offer
    assert offered is not None
    assert (offered.source, offered.trusted) == (OfferSource.AI, False)
    assert _ai_jobs(enriching) == 1


def test_under_approval_the_ai_is_asked_only_when_someone_asks(
    enriching: Enriching,
    offers: SplitOfferService,
    split_albums: Callable[[SplitAlbums], None],
    alice: Account,
) -> None:
    split_albums(SplitAlbums.APPROVAL)
    _long_file(enriching, "Mixtape", text_title="Album")

    offers.auto_split()

    assert _ai_jobs(enriching) == 0


def test_auto_asks_the_ai_about_a_few_files_at_a_time(
    enriching: Enriching,
    offers: SplitOfferService,
    split_albums: Callable[[SplitAlbums], None],
) -> None:
    split_albums(SplitAlbums.AUTO)
    for number in range(AI_AT_ONCE + 2):
        _long_file(enriching, f"Mixtape {number}", text_title="Album")

    offers.auto_split()

    assert _ai_jobs(enriching) == AI_AT_ONCE
