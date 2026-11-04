"""Applying the covers a scan found: embedded in a file, or in an image beside it."""

from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.covers import CoverService
from medleyplay.application.details import DetailsService
from medleyplay.application.libraries import apply_scan
from medleyplay.domain.catalog import TrackId
from medleyplay.domain.covers import cover_id
from medleyplay.domain.details import Field, Origin, Shown
from medleyplay.domain.libraries import LibraryId
from medleyplay.persistence.schema import SourceRow, TrackRow
from medleyplay.programs.scan_covers import CoverFile
from medleyplay.programs.scan_library import LibraryScan, ScannedFile
from tests.support.factories import CoverImageFactory, ScannedFileFactory
from tests.support.fakes import FakeClock
from tests.support.images import copy_of, jpeg_image, png_image, webp_image
from tests.support.libraries import library_row

SONG = "Blue/01 Intro.m4a"
BREMEN = jpeg_image("Bremen")
SUPERCELL = png_image("Supercell")


@pytest.fixture
def library(units: sessionmaker[Session], clock: FakeClock) -> LibraryId:
    return library_row(units, clock)


@pytest.fixture
def copies(tmp_path: Path) -> Path:
    """The folder of the copies a scan's Job made of the images it read."""
    return tmp_path / "work" / "covers"


@pytest.fixture
def store(tmp_path: Path) -> Path:
    """The folder covers are kept in, which is `covers`' folder."""
    return tmp_path / "data" / "covers"


def _scan(
    units: sessionmaker[Session],
    clock: FakeClock,
    library: LibraryId,
    store: Path,
    *files: ScannedFile,
) -> None:
    with units.begin() as db:
        apply_scan(db, library, LibraryScan(readable=True, files=files), clock, store)


def _track(units: sessionmaker[Session], path: str = SONG) -> TrackId:
    with units() as db:
        source = db.scalars(select(SourceRow).where(SourceRow.locator.endswith(path))).one()
        return TrackId(source.track_id)


def _shown(units: sessionmaker[Session], clock: FakeClock, path: str = SONG) -> dict[Field, Shown]:
    return DetailsService(units, clock).details(_track(units, path)).shown


def _cover_of(units: sessionmaker[Session], path: str = SONG) -> str | None:
    """The cover the Track's row holds, as every list shows it."""
    with units() as db:
        track = db.get(TrackRow, _track(units, path))
        assert track is not None
        return track.cover


def _source_details(units: sessionmaker[Session]) -> dict[str, object]:
    with units() as db:
        return dict(db.scalars(select(SourceRow)).one().details or {})


def _stored(store: Path) -> dict[str, bytes]:
    """Every cover in the store, by name."""
    return {file.name: file.read_bytes() for file in store.iterdir()} if store.is_dir() else {}


def test_an_embedded_cover_is_kept_and_shown_from_the_files_origin(
    units: sessionmaker[Session], clock: FakeClock, library: LibraryId, copies: Path, store: Path
) -> None:
    embedded = copy_of(copies, BREMEN)

    _scan(units, clock, library, store, ScannedFileFactory.song(SONG, embedded_cover=embedded))

    assert _shown(units, clock)[Field.COVER] == Shown(cover_id(BREMEN), Origin.FILES)
    assert _cover_of(units) == cover_id(BREMEN)
    assert _stored(store) == {cover_id(BREMEN): BREMEN}


def test_an_image_beside_a_file_is_kept_and_shown_from_the_files_origin(
    units: sessionmaker[Session], clock: FakeClock, library: LibraryId, copies: Path, store: Path
) -> None:
    beside = CoverImageFactory.read(copy_of(copies, SUPERCELL), extension="png")

    _scan(units, clock, library, store, ScannedFileFactory.song(SONG, cover_image=beside))

    assert _shown(units, clock)[Field.COVER] == Shown(cover_id(SUPERCELL), Origin.FILES)
    assert _cover_of(units) == cover_id(SUPERCELL)
    assert _stored(store) == {cover_id(SUPERCELL): SUPERCELL}


def test_a_cover_comes_with_the_files_other_values_and_leaves_them_shown(
    units: sessionmaker[Session], clock: FakeClock, library: LibraryId, copies: Path, store: Path
) -> None:
    embedded = copy_of(copies, BREMEN)

    _scan(
        units,
        clock,
        library,
        store,
        ScannedFileFactory.song(SONG, "Intro", embedded_cover=embedded),
    )

    shown = _shown(units, clock)
    assert shown[Field.TITLE] == Shown("Intro", Origin.FILES)
    assert shown[Field.ALBUM] == Shown("Blue", Origin.FILES)


def test_an_embedded_cover_wins_over_an_image_beside_the_file(
    units: sessionmaker[Session], clock: FakeClock, library: LibraryId, copies: Path, store: Path
) -> None:
    embedded = copy_of(copies, BREMEN)
    beside = CoverImageFactory.read(copy_of(copies, SUPERCELL), extension="png")

    _scan(
        units,
        clock,
        library,
        store,
        ScannedFileFactory.song(SONG, embedded_cover=embedded, cover_image=beside),
    )

    assert _shown(units, clock)[Field.COVER] == Shown(cover_id(BREMEN), Origin.FILES)


def test_a_copy_reported_as_another_files_bytes_is_no_cover(
    units: sessionmaker[Session], clock: FakeClock, library: LibraryId, tmp_path: Path, store: Path
) -> None:
    elsewhere = tmp_path / "elsewhere.jpg"
    elsewhere.write_bytes(BREMEN)
    misnamed = CoverFile(name=cover_id(SUPERCELL), path=str(elsewhere))

    _scan(units, clock, library, store, ScannedFileFactory.song(SONG, embedded_cover=misnamed))

    assert _cover_of(units) is None
    assert _stored(store) == {}


def test_a_file_with_neither_has_no_cover(
    units: sessionmaker[Session], clock: FakeClock, library: LibraryId, store: Path
) -> None:
    _scan(units, clock, library, store, ScannedFileFactory.song(SONG))

    assert Field.COVER not in _shown(units, clock)
    assert _cover_of(units) is None
    assert _stored(store) == {}


def test_two_songs_with_one_cover_share_its_file(
    units: sessionmaker[Session], clock: FakeClock, library: LibraryId, copies: Path, store: Path
) -> None:
    embedded = copy_of(copies, BREMEN)

    _scan(
        units,
        clock,
        library,
        store,
        ScannedFileFactory.song("Blue/01 Intro.m4a", embedded_cover=embedded),
        ScannedFileFactory.song("Blue/02 Outro.m4a", "Outro", embedded_cover=embedded),
    )

    assert _stored(store) == {cover_id(BREMEN): BREMEN}
    assert _cover_of(units, "Blue/02 Outro.m4a") == cover_id(BREMEN)


def test_an_image_new_beside_an_unchanged_file_becomes_its_cover_and_leaves_its_tags(
    units: sessionmaker[Session], clock: FakeClock, library: LibraryId, copies: Path, store: Path
) -> None:
    _scan(units, clock, library, store, ScannedFileFactory.song(SONG, "Intro"))
    beside = CoverImageFactory.read(copy_of(copies, BREMEN))

    _scan(units, clock, library, store, ScannedFileFactory.unchanged(SONG, cover_image=beside))

    shown = _shown(units, clock)
    assert shown[Field.COVER] == Shown(cover_id(BREMEN), Origin.FILES)
    assert shown[Field.TITLE] == Shown("Intro", Origin.FILES)
    assert shown[Field.ALBUM] == Shown("Blue", Origin.FILES)


def test_a_changed_image_replaces_the_cover_and_a_removed_image_drops_it(
    units: sessionmaker[Session], clock: FakeClock, library: LibraryId, copies: Path, store: Path
) -> None:
    first = CoverImageFactory.read(copy_of(copies, BREMEN))
    _scan(units, clock, library, store, ScannedFileFactory.song(SONG, cover_image=first))
    second = CoverImageFactory.read(copy_of(copies, SUPERCELL), modified_ns=2)

    _scan(units, clock, library, store, ScannedFileFactory.unchanged(SONG, cover_image=second))
    replaced = _shown(units, clock)[Field.COVER]
    _scan(units, clock, library, store, ScannedFileFactory.unchanged(SONG))

    assert replaced == Shown(cover_id(SUPERCELL), Origin.FILES)
    assert Field.COVER not in _shown(units, clock)
    assert _cover_of(units) is None
    assert _shown(units, clock)[Field.TITLE] == Shown("Intro", Origin.FILES)


def test_a_removed_image_leaves_the_stamp_and_name_no_longer_kept(
    units: sessionmaker[Session], clock: FakeClock, library: LibraryId, copies: Path, store: Path
) -> None:
    beside = CoverImageFactory.read(copy_of(copies, BREMEN))
    _scan(units, clock, library, store, ScannedFileFactory.song(SONG, cover_image=beside))

    _scan(units, clock, library, store, ScannedFileFactory.unchanged(SONG))

    assert _source_details(units).keys() == {"size", "modified_ns", "error", "reader"}


def test_an_image_the_scan_did_not_read_again_keeps_the_cover_and_its_stamp(
    units: sessionmaker[Session], clock: FakeClock, library: LibraryId, copies: Path, store: Path
) -> None:
    beside = CoverImageFactory.read(copy_of(copies, BREMEN), modified_ns=7)
    _scan(units, clock, library, store, ScannedFileFactory.song(SONG, cover_image=beside))
    skipped = CoverImageFactory.unchanged(modified_ns=7)

    _scan(units, clock, library, store, ScannedFileFactory.unchanged(SONG, cover_image=skipped))

    assert _shown(units, clock)[Field.COVER] == Shown(cover_id(BREMEN), Origin.FILES)
    assert _source_details(units)["cover_image"] == {
        "extension": "jpg",
        "size": 100,
        "modified_ns": 7,
        "name": cover_id(BREMEN),
    }


def test_a_changed_file_keeps_the_cover_of_the_image_beside_it_that_was_not_read_again(
    units: sessionmaker[Session], clock: FakeClock, library: LibraryId, copies: Path, store: Path
) -> None:
    beside = CoverImageFactory.read(copy_of(copies, BREMEN))
    _scan(units, clock, library, store, ScannedFileFactory.song(SONG, cover_image=beside))
    skipped = CoverImageFactory.unchanged()

    _scan(
        units, clock, library, store, ScannedFileFactory.song(SONG, "Retagged", cover_image=skipped)
    )

    assert _shown(units, clock)[Field.TITLE] == Shown("Retagged", Origin.FILES)
    assert _shown(units, clock)[Field.COVER] == Shown(cover_id(BREMEN), Origin.FILES)


def test_an_embedded_cover_stays_when_an_image_appears_beside_an_unchanged_file(
    units: sessionmaker[Session], clock: FakeClock, library: LibraryId, copies: Path, store: Path
) -> None:
    embedded = copy_of(copies, BREMEN)
    _scan(units, clock, library, store, ScannedFileFactory.song(SONG, embedded_cover=embedded))
    beside = CoverImageFactory.read(copy_of(copies, SUPERCELL), extension="png")

    _scan(units, clock, library, store, ScannedFileFactory.unchanged(SONG, cover_image=beside))

    assert _shown(units, clock)[Field.COVER] == Shown(cover_id(BREMEN), Origin.FILES)


def test_an_image_beside_the_file_shows_when_the_embedded_cover_is_removed(
    units: sessionmaker[Session], clock: FakeClock, library: LibraryId, copies: Path, store: Path
) -> None:
    embedded = copy_of(copies, BREMEN)
    beside = CoverImageFactory.read(copy_of(copies, SUPERCELL), extension="png")
    _scan(
        units,
        clock,
        library,
        store,
        ScannedFileFactory.song(SONG, embedded_cover=embedded, cover_image=beside),
    )
    skipped = CoverImageFactory.unchanged(extension="png")

    _scan(units, clock, library, store, ScannedFileFactory.song(SONG, cover_image=skipped))

    assert _shown(units, clock)[Field.COVER] == Shown(cover_id(SUPERCELL), Origin.FILES)


def test_a_changed_file_that_lost_its_embedded_cover_has_none_unless_an_image_is_beside_it(
    units: sessionmaker[Session], clock: FakeClock, library: LibraryId, copies: Path, store: Path
) -> None:
    embedded = copy_of(copies, BREMEN)
    _scan(units, clock, library, store, ScannedFileFactory.song(SONG, embedded_cover=embedded))

    _scan(units, clock, library, store, ScannedFileFactory.song(SONG, "Stripped"))

    assert Field.COVER not in _shown(units, clock)


def test_a_file_whose_tags_could_not_be_read_keeps_the_cover_it_had(
    units: sessionmaker[Session], clock: FakeClock, library: LibraryId, copies: Path, store: Path
) -> None:
    embedded = copy_of(copies, BREMEN)
    _scan(units, clock, library, store, ScannedFileFactory.song(SONG, embedded_cover=embedded))
    unreadable = ScannedFile(path=SONG, size=2000, modified_ns=2, changed=True, error="can't read")

    _scan(units, clock, library, store, unreadable)

    assert _shown(units, clock)[Field.COVER] == Shown(cover_id(BREMEN), Origin.FILES)


def test_the_households_cover_stays_over_the_covers_a_scan_finds_and_drops(
    units: sessionmaker[Session],
    clock: FakeClock,
    library: LibraryId,
    copies: Path,
    store: Path,
    covers: CoverService,
) -> None:
    _scan(units, clock, library, store, ScannedFileFactory.song(SONG))
    mine = webp_image("Mine")
    covers.set_cover(_track(units), mine)
    beside = CoverImageFactory.read(copy_of(copies, BREMEN))

    _scan(units, clock, library, store, ScannedFileFactory.unchanged(SONG, cover_image=beside))
    found = DetailsService(units, clock).details(_track(units)).values
    _scan(units, clock, library, store, ScannedFileFactory.unchanged(SONG))

    assert found[Origin.FILES][Field.COVER] == cover_id(BREMEN)
    assert _shown(units, clock)[Field.COVER] == Shown(cover_id(mine), Origin.HOUSEHOLD)
    assert _cover_of(units) == cover_id(mine)


def test_the_households_no_cover_stays_over_a_cover_a_scan_finds(
    units: sessionmaker[Session],
    clock: FakeClock,
    library: LibraryId,
    copies: Path,
    store: Path,
    details: DetailsService,
) -> None:
    _scan(units, clock, library, store, ScannedFileFactory.song(SONG))
    details.put_household(_track(units), {"cover": ""})
    embedded = copy_of(copies, BREMEN)

    _scan(units, clock, library, store, ScannedFileFactory.song(SONG, embedded_cover=embedded))

    assert _cover_of(units) is None


def test_the_sweep_keeps_a_cover_a_scan_recorded_and_removes_one_it_dropped(
    units: sessionmaker[Session],
    clock: FakeClock,
    library: LibraryId,
    copies: Path,
    store: Path,
    covers: CoverService,
) -> None:
    embedded = copy_of(copies, BREMEN)
    beside = CoverImageFactory.read(copy_of(copies, SUPERCELL), extension="png")
    _scan(
        units,
        clock,
        library,
        store,
        ScannedFileFactory.song("Blue/01 Intro.m4a", embedded_cover=embedded),
        ScannedFileFactory.song("Blue/02 Outro.m4a", "Outro", cover_image=beside),
    )

    covers.sweep()
    kept = set(_stored(store))
    _scan(
        units,
        clock,
        library,
        store,
        ScannedFileFactory.unchanged("Blue/01 Intro.m4a"),
        ScannedFileFactory.unchanged("Blue/02 Outro.m4a"),
    )
    covers.sweep()

    assert kept == {cover_id(BREMEN), cover_id(SUPERCELL)}
    assert _stored(store) == {cover_id(BREMEN): BREMEN}


def test_an_image_that_is_no_cover_is_a_noted_error_and_keeps_the_cover_before(
    units: sessionmaker[Session], clock: FakeClock, library: LibraryId, copies: Path, store: Path
) -> None:
    beside = CoverImageFactory.read(copy_of(copies, BREMEN))
    _scan(units, clock, library, store, ScannedFileFactory.song(SONG, cover_image=beside))
    gif = CoverImageFactory.not_a_cover(modified_ns=2)

    _scan(units, clock, library, store, ScannedFileFactory.unchanged(SONG, cover_image=gif))

    details = _source_details(units)
    assert details["cover_image_error"] == "isn't a JPEG, PNG, or WebP image"
    assert details["cover_image"] == {
        "extension": "jpg",
        "size": 100,
        "modified_ns": 2,
        "name": cover_id(BREMEN),
    }
    assert _shown(units, clock)[Field.COVER] == Shown(cover_id(BREMEN), Origin.FILES)


def test_a_noted_error_stays_noted_until_the_image_is_read_well(
    units: sessionmaker[Session], clock: FakeClock, library: LibraryId, copies: Path, store: Path
) -> None:
    gif = CoverImageFactory.not_a_cover()
    _scan(units, clock, library, store, ScannedFileFactory.song(SONG, cover_image=gif))

    skipped = CoverImageFactory.unchanged()
    _scan(units, clock, library, store, ScannedFileFactory.unchanged(SONG, cover_image=skipped))
    still_noted = _source_details(units).get("cover_image_error")
    mended = CoverImageFactory.read(copy_of(copies, BREMEN), modified_ns=2)
    _scan(units, clock, library, store, ScannedFileFactory.unchanged(SONG, cover_image=mended))

    assert still_noted == "isn't a JPEG, PNG, or WebP image"
    assert "cover_image_error" not in _source_details(units)
    assert _shown(units, clock)[Field.COVER] == Shown(cover_id(BREMEN), Origin.FILES)


def test_a_removed_image_clears_the_error_noted_for_it(
    units: sessionmaker[Session], clock: FakeClock, library: LibraryId, store: Path
) -> None:
    gif = CoverImageFactory.not_a_cover()
    _scan(units, clock, library, store, ScannedFileFactory.song(SONG, cover_image=gif))

    _scan(units, clock, library, store, ScannedFileFactory.unchanged(SONG))

    assert _source_details(units).keys() == {"size", "modified_ns", "error", "reader"}


def test_an_image_unreadable_for_now_keeps_the_stamp_read_before_so_the_next_scan_reads_it(
    units: sessionmaker[Session], clock: FakeClock, library: LibraryId, copies: Path, store: Path
) -> None:
    beside = CoverImageFactory.read(copy_of(copies, BREMEN))
    _scan(units, clock, library, store, ScannedFileFactory.song(SONG, cover_image=beside))
    late = CoverImageFactory.unreadable_for_now(modified_ns=2)

    _scan(units, clock, library, store, ScannedFileFactory.unchanged(SONG, cover_image=late))

    details = _source_details(units)
    assert details["cover_image"] == {
        "extension": "jpg",
        "size": 100,
        "modified_ns": 1,
        "name": cover_id(BREMEN),
    }
    assert "can't be read" in str(details["cover_image_error"])
    assert _shown(units, clock)[Field.COVER] == Shown(cover_id(BREMEN), Origin.FILES)


def test_a_copy_that_cant_be_read_by_the_server_is_a_noted_error_to_read_again(
    units: sessionmaker[Session], clock: FakeClock, library: LibraryId, copies: Path, store: Path
) -> None:
    copy = copy_of(copies, BREMEN)
    Path(copy.path).unlink()
    vanished = CoverImageFactory.read(copy)

    _scan(units, clock, library, store, ScannedFileFactory.song(SONG, cover_image=vanished))

    details = _source_details(units)
    assert "can't be read" in str(details["cover_image_error"])
    assert "cover_image" not in details
    assert Field.COVER not in _shown(units, clock)


def test_a_copy_whose_bytes_are_no_cover_is_not_kept(
    units: sessionmaker[Session], clock: FakeClock, library: LibraryId, copies: Path, store: Path
) -> None:
    fake = copy_of(copies, BREMEN)
    Path(fake.path).write_bytes(b"GIF89a")
    beside = CoverImageFactory.read(fake)

    _scan(units, clock, library, store, ScannedFileFactory.song(SONG, cover_image=beside))

    assert _source_details(units)["cover_image_error"] == "isn't a JPEG, PNG, or WebP image"
    assert Field.COVER not in _shown(units, clock)
    assert _stored(store) == {}


def test_a_moved_file_takes_the_cover_found_at_its_new_path(
    units: sessionmaker[Session], clock: FakeClock, library: LibraryId, copies: Path, store: Path
) -> None:
    before = CoverImageFactory.read(copy_of(copies, BREMEN))
    _scan(
        units,
        clock,
        library,
        store,
        ScannedFileFactory.song(f"old/{SONG}", fingerprint="f1", cover_image=before),
    )
    after = CoverImageFactory.read(copy_of(copies, SUPERCELL), extension="png")

    _scan(
        units,
        clock,
        library,
        store,
        ScannedFileFactory.song(f"new/{SONG}", fingerprint="f1", cover_image=after),
    )

    assert _shown(units, clock, f"new/{SONG}")[Field.COVER] == Shown(
        cover_id(SUPERCELL), Origin.FILES
    )
