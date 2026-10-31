"""Covers: images kept once by their content, shown on Tracks, and swept when unused."""

from pathlib import Path

import pytest
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.accounts import AccountService
from medleyplay.application.catalog import CatalogService
from medleyplay.application.covers import CoverService
from medleyplay.application.details import DetailsService, record
from medleyplay.application.segments import SongsService
from medleyplay.domain.accounts import Account
from medleyplay.domain.catalog import TrackId
from medleyplay.domain.covers import MAX_COVER_BYTES, CoverType, cover_id
from medleyplay.domain.details import Field, Origin, Shown
from medleyplay.domain.errors import InvalidInputError, NotFoundError
from medleyplay.domain.segments import SongRow
from medleyplay.domain.video_text import Song
from tests.support.factories import NewAccountFactory, SourceKeyFactory, TrackDetailsFactory
from tests.support.fakes import FakeClock

PNG = b"\x89PNG\r\n\x1a\n" + b"cover of Bremen"
"""A PNG image's bytes, as far as a cover needs them."""
JPEG = b"\xff\xd8\xff\xe0" + b"another cover"


@pytest.fixture
def alice(accounts: AccountService) -> Account:
    return accounts.create_first_admin(NewAccountFactory.admin()).account


@pytest.fixture
def covers(units: sessionmaker[Session], clock: FakeClock, tmp_path: Path) -> CoverService:
    return CoverService(units, clock, tmp_path / "covers")


def _song(catalog: CatalogService, part: int = 1) -> TrackId:
    return catalog.add_track(SourceKeyFactory.bilibili(part=part), TrackDetailsFactory.song())


def test_a_cover_set_on_two_tracks_is_kept_once_named_by_its_bytes(
    covers: CoverService, catalog: CatalogService, alice: Account, tmp_path: Path
) -> None:
    first, second = _song(catalog, 1), _song(catalog, 2)

    covers.set_cover(first, PNG)
    covers.set_cover(second, PNG)

    assert [path.name for path in (tmp_path / "covers").iterdir()] == [cover_id(PNG)]
    assert catalog.get_track(alice.id, second).details.cover == cover_id(PNG)


def test_the_households_cover_wins_and_removing_it_shows_the_videos_again(
    covers: CoverService,
    details: DetailsService,
    catalog: CatalogService,
    units: sessionmaker[Session],
    clock: FakeClock,
) -> None:
    track = _song(catalog)
    with units.begin() as db:
        record(db, track, Origin.VIDEO, {Field.TITLE: "Intro", Field.COVER: cover_id(PNG)}, clock())
    covers.set_cover(track, JPEG)
    assert details.details(track).shown[Field.COVER] == Shown(cover_id(JPEG), Origin.HOUSEHOLD)

    covers.remove_cover(track)

    assert details.details(track).shown[Field.COVER] == Shown(cover_id(PNG), Origin.VIDEO)


def test_a_split_files_songs_take_its_cover(
    covers: CoverService, songs: SongsService, details: DetailsService, catalog: CatalogService
) -> None:
    album = catalog.add_track(
        SourceKeyFactory.bilibili("BV1dm4y1s7ak"), TrackDetailsFactory.album_file()
    )
    first = songs.save(
        album, [SongRow(None, Song(0, "A")), SongRow(None, Song(60_000, "B"))]
    ).songs[0]

    covers.set_cover(album, PNG)

    assert details.details(first.track_id).shown[Field.COVER] == Shown(
        cover_id(PNG), Origin.ALBUM_FILE
    )


@pytest.mark.parametrize(
    "data",
    [b"GIF89a....", b"<svg/>", b"\xff\xd8\xff" + b"\0" * MAX_COVER_BYTES],
    ids=["a GIF", "an SVG", "a JPEG over the limit"],
)
def test_anything_but_a_jpeg_png_or_webp_within_the_limit_is_refused(
    covers: CoverService, catalog: CatalogService, data: bytes, tmp_path: Path
) -> None:
    track = _song(catalog)

    with pytest.raises(InvalidInputError):
        covers.set_cover(track, data)

    assert not (tmp_path / "covers").exists() or list((tmp_path / "covers").iterdir()) == []


def test_a_cover_for_a_missing_track_is_not_found(covers: CoverService) -> None:
    with pytest.raises(NotFoundError):
        covers.set_cover(TrackId(999), PNG)


def test_a_cover_opens_as_its_file_and_type(covers: CoverService, catalog: CatalogService) -> None:
    covers.set_cover(_song(catalog), PNG)

    opened = covers.open(cover_id(PNG))

    assert opened is not None
    assert (opened[0].read_bytes(), opened[1]) == (PNG, CoverType.PNG)


@pytest.mark.parametrize(
    "name", ["0" * 64, "../covers", "cover.png"], ids=["unknown", "a path", "a file name"]
)
def test_a_name_of_no_cover_opens_nothing(covers: CoverService, name: str) -> None:
    assert covers.open(name) is None


def test_the_sweep_removes_the_covers_no_track_shows_or_keeps(
    covers: CoverService, catalog: CatalogService, tmp_path: Path
) -> None:
    track = _song(catalog)
    covers.set_cover(track, JPEG)
    covers.set_cover(track, PNG)
    (tmp_path / "covers" / "left-over.tmp").write_bytes(b"half written")

    covers.sweep()

    assert [path.name for path in (tmp_path / "covers").iterdir()] == [cover_id(PNG)]
