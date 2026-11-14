"""Artist names written with more than the name: finding them, tidying them, keeping them."""

from dataclasses import replace

import pytest

from medleyplay.application.accounts import AccountService
from medleyplay.application.catalog import CatalogService
from medleyplay.application.details import DetailsService, NameToTidy
from medleyplay.application.segments import SongsService
from medleyplay.domain.accounts import Account
from medleyplay.domain.catalog import TrackId
from medleyplay.domain.details import Field, Origin, Shown
from medleyplay.domain.errors import InvalidInputError, NotFoundError
from medleyplay.domain.segments import SongRow
from medleyplay.domain.tidy import NameKind, Tidied
from medleyplay.domain.video_text import Song
from tests.support.factories import NewAccountFactory, SourceKeyFactory, TrackDetailsFactory

JAY: str = "周杰伦2000年发行首张个人"
BEATLES: str = "The Beatles\uff08披头士\uff09"


@pytest.fixture
def alice(accounts: AccountService) -> Account:
    return accounts.create_first_admin(NewAccountFactory.admin()).account


def _song(
    catalog: CatalogService,
    part: int,
    *,
    artist: str,
    album_artist: str = "",
    album: str = "Blue",
    year: int | None = None,
) -> TrackId:
    """Add one part of a Bilibili video whose details name `artist`."""
    details = replace(
        TrackDetailsFactory.song(f"Song {part}"),
        artist=artist,
        album_artist=album_artist,
        album=album,
        year=year,
    )
    return catalog.add_track(SourceKeyFactory.bilibili(part=part), details)


def test_a_name_to_tidy_is_found_with_every_track_that_shows_it(
    catalog: CatalogService, details: DetailsService
) -> None:
    first = _song(catalog, 1, artist=JAY)
    second = _song(catalog, 2, artist=JAY, year=2000)
    _song(catalog, 3, artist="The Band")

    found = details.names_to_tidy()

    assert found == [
        NameToTidy(
            NameKind.ARTIST,
            JAY,
            Tidied("周杰伦", 2000),
            (Field.ARTIST,),
            (first, second),
            years_differ=0,
        )
    ]


def test_an_album_artist_is_tidied_too(catalog: CatalogService, details: DetailsService) -> None:
    track = _song(catalog, 1, artist="The Beatles", album_artist=BEATLES)

    found = details.names_to_tidy()

    assert found == [
        NameToTidy(
            NameKind.ARTIST,
            BEATLES,
            Tidied("The Beatles", None),
            (Field.ALBUM_ARTIST,),
            (track,),
            years_differ=0,
        )
    ]


def test_a_name_shown_as_artist_and_album_artist_is_offered_once(
    catalog: CatalogService, details: DetailsService
) -> None:
    track = _song(catalog, 1, artist=JAY, album_artist=JAY)

    [found] = details.names_to_tidy()

    assert (found.fields, found.track_ids) == ((Field.ARTIST, Field.ALBUM_ARTIST), (track,))


def test_a_track_whose_year_differs_from_the_names_is_counted(
    catalog: CatalogService, details: DetailsService
) -> None:
    _song(catalog, 1, artist=JAY, year=2001)

    [found] = details.names_to_tidy()

    assert found.years_differ == 1


def test_tidying_a_name_sets_it_where_each_track_shows_it_and_the_year_where_none_is_shown(
    catalog: CatalogService, details: DetailsService, alice: Account
) -> None:
    undated = _song(catalog, 1, artist=JAY, album_artist=JAY)
    dated = _song(catalog, 2, artist=JAY, year=2001)

    changed = details.tidy_name(NameKind.ARTIST, JAY)

    assert changed == 2
    shown = details.details(undated).shown
    assert shown[Field.ARTIST] == Shown("周杰伦", Origin.HOUSEHOLD)
    assert shown[Field.ALBUM_ARTIST] == Shown("周杰伦", Origin.HOUSEHOLD)
    assert shown[Field.YEAR] == Shown(2000, Origin.HOUSEHOLD)
    track = catalog.get_track(alice.id, dated).details
    assert (track.artist, track.album_artist, track.year) == ("周杰伦", "", 2001)
    assert details.names_to_tidy() == []


def test_a_name_kept_as_written_is_no_longer_offered(
    catalog: CatalogService, details: DetailsService
) -> None:
    track = _song(catalog, 1, artist=JAY)

    details.keep_name(NameKind.ARTIST, JAY)

    assert details.names_to_tidy() == []
    assert details.details(track).shown[Field.ARTIST] == Shown(JAY, Origin.VIDEO)


def test_tidying_a_name_no_track_shows_is_not_found(
    catalog: CatalogService, details: DetailsService
) -> None:
    _song(catalog, 1, artist="The Band")

    with pytest.raises(NotFoundError, match="No Track shows"):
        details.tidy_name(NameKind.ARTIST, JAY)


def test_a_name_with_nothing_to_tidy_is_refused(details: DetailsService) -> None:
    with pytest.raises(InvalidInputError, match="nothing to tidy"):
        details.tidy_name(NameKind.ARTIST, "The Band")


def test_an_album_name_to_tidy_is_found_apart_from_artist_names(
    catalog: CatalogService, details: DetailsService
) -> None:
    track = _song(catalog, 1, artist="周杰伦", album="范特西2001年发行")

    found = details.names_to_tidy()

    assert found == [
        NameToTidy(
            NameKind.ALBUM,
            "范特西2001年发行",
            Tidied("范特西", 2001),
            (Field.ALBUM,),
            (track,),
            years_differ=0,
        )
    ]


def test_keeping_an_album_name_leaves_the_same_text_as_an_artist_offered(
    catalog: CatalogService, details: DetailsService
) -> None:
    _song(catalog, 1, artist=JAY, album=JAY)

    details.keep_name(NameKind.ALBUM, JAY)

    assert [(name.kind, name.written) for name in details.names_to_tidy()] == [
        (NameKind.ARTIST, JAY)
    ]


def test_a_split_files_songs_follow_their_files_tidied_album(
    catalog: CatalogService, details: DetailsService, songs: SongsService
) -> None:
    edition = replace(TrackDetailsFactory.album_file(), album="Bremen (Deluxe Edition)")
    album = catalog.add_track(SourceKeyFactory.bilibili("BV1dm4y1s7ak"), edition)
    first = songs.save(
        album, [SongRow(None, Song(0, "アイネクライネ")), SongRow(None, Song(252_000, "Last"))]
    ).songs[0]

    details.tidy_name(NameKind.ALBUM, "Bremen (Deluxe Edition)")

    assert details.details(album).shown[Field.ALBUM] == Shown("Bremen", Origin.HOUSEHOLD)
    assert details.details(first.track_id).shown[Field.ALBUM] == Shown("Bremen", Origin.ALBUM_FILE)
