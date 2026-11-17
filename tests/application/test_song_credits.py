"""A song's artists chosen one by one: each artist bound apart, with how the song credits it.

The household's choice for one song wins over the decision for its name, and lasts
until the song's artist is written again some other way.
"""

from datetime import timedelta

import pytest
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.artist_splits import ArtistSplitService
from medleyplay.application.catalog import CatalogService
from medleyplay.application.details import DetailsService, record
from medleyplay.application.segments import SongsService
from medleyplay.application.track_artists import BoundArtist, artists_of
from medleyplay.domain.artist_split import Credit, Role
from medleyplay.domain.catalog import SourceKey, TrackDetails, TrackId
from medleyplay.domain.details import Field, Origin
from medleyplay.domain.errors import InvalidInputError
from medleyplay.domain.segments import SongRow
from medleyplay.domain.video_text import Song
from tests.support.factories import SourceKeyFactory, TrackDetailsFactory
from tests.support.fakes import FakeClock

GUMI_AND_MAYU = (Credit("GUMI"), Credit("MAYU"))
FEATURING_GUMI = (Credit("スズム"), Credit("GUMI", Role.FEATURED))


@pytest.fixture
def splits(units: sessionmaker[Session], clock: FakeClock) -> ArtistSplitService:
    return ArtistSplitService(units, clock)


def _song(catalog: CatalogService, title: str, artist: str) -> TrackId:
    """Add a Library file `<title>.m4a` whose tags name `artist`."""
    key = SourceKey("library", f"1/Music/{title}.m4a")
    return catalog.add_track(key, TrackDetails(title=title, artist=artist))


def _credited(units: sessionmaker[Session], track_id: TrackId) -> list[tuple[str, Role]]:
    """The artists the Track shows as its artists, as written, with their roles."""
    with units() as db:
        return [(each.written, each.role) for each in artists_of(db, track_id).artists]


def _bound(units: sessionmaker[Session], track_id: TrackId) -> tuple[BoundArtist, ...]:
    with units() as db:
        return artists_of(db, track_id).artists


def test_a_songs_artists_chosen_one_by_one_are_each_bound_with_their_roles(
    catalog: CatalogService, details: DetailsService, units: sessionmaker[Session]
) -> None:
    song = _song(catalog, "ケビョウニンゲン", "GUMI")
    gumi_song = _song(catalog, "Another", "GUMI")

    details.set_on_many([song], {}, artists=FEATURING_GUMI)

    assert _credited(units, song) == [("スズム", Role.MAIN), ("GUMI", Role.FEATURED)]
    assert _bound(units, song)[1].artist_id == _bound(units, gumi_song)[0].artist_id


def test_a_song_with_artists_chosen_shows_them_as_one_name(
    catalog: CatalogService, details: DetailsService
) -> None:
    song = _song(catalog, "ケビョウニンゲン", "GUMI")

    details.set_on_many([song], {}, artists=GUMI_AND_MAYU)

    view = details.details(song)
    assert view.shown[Field.ARTIST].value == "GUMI & MAYU"
    assert view.artists_chosen


def test_featured_artists_are_bound_after_the_main_ones(
    catalog: CatalogService, details: DetailsService, units: sessionmaker[Session]
) -> None:
    song = _song(catalog, "ケビョウニンゲン", "GUMI")

    details.set_on_many([song], {}, artists=(Credit("GUMI", Role.FEATURED), Credit("スズム")))

    assert _credited(units, song) == [("スズム", Role.MAIN), ("GUMI", Role.FEATURED)]


def test_one_main_artist_chosen_is_the_artist_as_written(
    catalog: CatalogService, details: DetailsService, units: sessionmaker[Session]
) -> None:
    song = _song(catalog, "ケビョウニンゲン", "GUMI/MAYU")

    details.set_on_many([song], {}, artists=(Credit("GUMI"),))

    view = details.details(song)
    assert view.values[Origin.HOUSEHOLD] == {Field.ARTIST: "GUMI"}
    assert not view.artists_chosen
    assert _credited(units, song) == [("GUMI", Role.MAIN)]


def test_choosing_the_artists_a_song_shows_already_changes_nothing(
    catalog: CatalogService,
    details: DetailsService,
    splits: ArtistSplitService,
    units: sessionmaker[Session],
) -> None:
    song = _song(catalog, "ケビョウニンゲン", "スズム (feat. GUMI)")
    splits.split(["スズム (feat. GUMI)"])

    details.set_on_many([song], {}, artists=FEATURING_GUMI)

    view = details.details(song)
    assert Origin.HOUSEHOLD not in view.values
    assert not view.artists_chosen
    assert view.shown[Field.ARTIST].value == "スズム (feat. GUMI)"


def test_artists_chosen_for_a_song_win_over_the_decision_for_its_name(
    catalog: CatalogService,
    details: DetailsService,
    splits: ArtistSplitService,
    units: sessionmaker[Session],
) -> None:
    song = _song(catalog, "ケビョウニンゲン", "GUMI/MAYU")
    other = _song(catalog, "Another", "GUMI & MAYU")
    details.set_on_many([song], {}, artists=GUMI_AND_MAYU)

    splits.keep(["GUMI & MAYU"])

    assert _credited(units, song) == [("GUMI", Role.MAIN), ("MAYU", Role.MAIN)]
    assert _credited(units, other) == [("GUMI & MAYU", Role.MAIN)]


def test_artists_chosen_last_while_the_files_tags_change(
    catalog: CatalogService,
    details: DetailsService,
    units: sessionmaker[Session],
    clock: FakeClock,
) -> None:
    song = _song(catalog, "ケビョウニンゲン", "GUMI")
    details.set_on_many([song], {}, artists=GUMI_AND_MAYU)
    clock.advance(timedelta(minutes=1))

    with units.begin() as db:
        record(
            db, song, Origin.FILES, {Field.TITLE: "ケビョウニンゲン", Field.ARTIST: "MAYU"}, clock()
        )

    assert _credited(units, song) == [("GUMI", Role.MAIN), ("MAYU", Role.MAIN)]


@pytest.mark.parametrize("artist", ["GUMI & MAYU", "GUMI"], ids=["as shown", "another"])
def test_writing_a_songs_artist_again_forgets_the_artists_chosen(
    catalog: CatalogService, details: DetailsService, units: sessionmaker[Session], artist: str
) -> None:
    song = _song(catalog, "ケビョウニンゲン", "GUMI")
    details.set_on_many([song], {}, artists=GUMI_AND_MAYU)

    details.set_on_many([song], {"artist": artist})

    assert not details.details(song).artists_chosen
    assert _credited(units, song) == [(artist, Role.MAIN)]


def test_dropping_the_households_artist_forgets_the_artists_chosen(
    catalog: CatalogService, details: DetailsService, units: sessionmaker[Session]
) -> None:
    song = _song(catalog, "ケビョウニンゲン", "GUMI")
    details.set_on_many([song], {}, artists=GUMI_AND_MAYU)

    details.set_on_many([song], {"artist": None})

    assert not details.details(song).artists_chosen
    assert _credited(units, song) == [("GUMI", Role.MAIN)]


def test_the_artists_of_one_song_only_are_chosen_at_once(
    catalog: CatalogService, details: DetailsService
) -> None:
    first = _song(catalog, "One", "GUMI")
    second = _song(catalog, "Two", "GUMI")

    with pytest.raises(InvalidInputError, match="one song"):
        details.set_on_many([first, second], {}, artists=GUMI_AND_MAYU)


def test_the_artists_and_the_artist_written_are_not_chosen_together(
    catalog: CatalogService, details: DetailsService
) -> None:
    song = _song(catalog, "One", "GUMI")

    with pytest.raises(InvalidInputError):
        details.set_on_many([song], {"artist": "GUMI"}, artists=GUMI_AND_MAYU)


@pytest.mark.parametrize(
    "artists",
    [
        (),
        (Credit("GUMI", Role.FEATURED),),
        (Credit("GUMI"), Credit(" gumi ")),
        (Credit("GUMI"), Credit("  ")),
        tuple(Credit(f"Artist {n}") for n in range(11)),
        (Credit("GUMI"), Credit("x" * 513)),
    ],
    ids=["none", "none main", "one twice", "one blank", "more than ten", "too long"],
)
def test_artists_chosen_that_no_song_could_credit_are_refused(
    catalog: CatalogService, details: DetailsService, artists: tuple[Credit, ...]
) -> None:
    song = _song(catalog, "One", "GUMI")

    with pytest.raises(InvalidInputError):
        details.set_on_many([song], {}, artists=artists)


def test_the_artists_of_a_file_split_into_songs_are_not_chosen_one_by_one(
    catalog: CatalogService, details: DetailsService, songs: SongsService
) -> None:
    album = catalog.add_track(
        SourceKeyFactory.bilibili("BV1dm4y1s7ak"), TrackDetailsFactory.album_file()
    )
    songs.save(
        album, (SongRow(None, Song(0, "アイネクライネ")), SongRow(None, Song(252_000, "Last")))
    )

    with pytest.raises(InvalidInputError, match="split"):
        details.set_on_many([album], {}, artists=GUMI_AND_MAYU)


def test_a_song_whose_artists_were_chosen_is_not_offered_to_split_or_tidy(
    catalog: CatalogService, details: DetailsService, splits: ArtistSplitService
) -> None:
    chosen = _song(catalog, "One", "GUMI")
    details.set_on_many([chosen], {}, artists=FEATURING_GUMI)
    _song(catalog, "Two", "スズム feat. GUMI")

    offers = splits.offers()
    tidy = details.names_to_tidy()

    assert [(offer.written, offer.songs) for offer in offers] == [("スズム feat. GUMI", 1)]
    assert all(chosen not in name.track_ids for name in tidy)


def test_the_artists_a_song_shows_are_listed_with_its_details(
    catalog: CatalogService, details: DetailsService
) -> None:
    song = _song(catalog, "ケビョウニンゲン", "GUMI")
    details.set_on_many([song], {}, artists=FEATURING_GUMI)

    view = details.details(song)

    assert [(each.written, each.role) for each in view.artists] == [
        ("スズム", Role.MAIN),
        ("GUMI", Role.FEATURED),
    ]
