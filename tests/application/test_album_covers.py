"""An album's covers: the front covers of its releases MusicBrainz knows, and an AI model's pick.

Nothing changes the album's cover until the household chooses one; what is found is
kept, and finding again replaces it.
"""

# cspell:ignore Straße STRASSE Strasse strasse

from collections.abc import Iterator
from dataclasses import replace
from datetime import timedelta
from pathlib import Path

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.accounts import AccountService
from medleyplay.application.album_covers import (
    FIND_COVERS_KIND,
    AlbumCovers,
    ChosenAlbumCover,
    MissingCover,
    album_key,
)
from medleyplay.application.covers import COVERS_FOLDER, keep_cover
from medleyplay.application.segments import SongsService
from medleyplay.application.settings import SettingsService
from medleyplay.domain.accounts import Account
from medleyplay.domain.catalog import TrackId
from medleyplay.domain.covers import cover_id
from medleyplay.domain.errors import ConflictError, InvalidInputError
from medleyplay.domain.segments import SongRow
from medleyplay.domain.settings import CoverSearch
from medleyplay.domain.video_text import Song
from medleyplay.persistence.schema import AlbumCoverSearchRow, JobRow, TrackRow
from medleyplay.programs.find_covers import ChooseCoverJob
from tests.support.ai import DEEPSEEK
from tests.support.enrichment import Enriching, running_enrichment
from tests.support.factories import NewAccountFactory
from tests.support.fakes import FakeClock
from tests.support.images import jpeg_image
from tests.support.musicbrainz import BEATLES
from tests.support.plugins.reader import HELP_CD, HELP_VINYL


@pytest.fixture
def alice(accounts: AccountService) -> Account:
    return accounts.create_first_admin(NewAccountFactory.admin()).account


@pytest.fixture
def enriching(
    units: sessionmaker[Session], clock: FakeClock, tmp_path: Path, alice: Account
) -> Iterator[Enriching]:
    """The Library holding *Help!* by The Beatles, and DeepSeek set up to ask."""
    with running_enrichment(units, clock, tmp_path / "data") as running:
        running.ai.add(alice, DEEPSEEK, "deepseek-flash", None)
        running.add_song("Help!", artist="The Beatles", album="Help!")
        running.add_song(
            "Yesterday", artist="Paul McCartney", album="Help!", album_artist="The Beatles"
        )
        yield running


def _found(enriching: Enriching, caller: Account, album: str = "Help!") -> AlbumCovers:
    """Have `caller` find the album's covers, and return what is known once MusicBrainz answered."""
    enriching.album_covers.find(caller, album, "The Beatles")
    enriching.finish_every_job()
    return enriching.album_covers.covers(caller, album, "The Beatles")


def _chosen(enriching: Enriching, caller: Account) -> AlbumCovers:
    """Have `caller` ask a model which of *Help!*'s releases fits, and return what it picked."""
    enriching.album_covers.choose(caller, "Help!", "The Beatles")
    enriching.finish_every_job()
    return enriching.album_covers.covers(caller, "Help!", "The Beatles")


def _jobs_of(enriching: Enriching, kind: str) -> int:
    with enriching.units() as db:
        return db.scalar(select(func.count()).select_from(JobRow).where(JobRow.kind == kind)) or 0


def test_the_covers_of_an_albums_releases_are_found_best_first_each_kept_as_a_cover(
    enriching: Enriching, alice: Account
) -> None:
    found = _found(enriching, alice)

    assert [each.option.release_id for each in found.covers] == [HELP_VINYL, HELP_CD]
    assert [each.option.date for each in found.covers] == ["1965-08-06", "1987-04-30"]
    covers = enriching.data_dir / COVERS_FOLDER
    assert [(covers / each.cover).read_bytes() for each in found.covers] == [
        jpeg_image("Help! 1965"),
        jpeg_image("Help! 1987"),
    ]
    assert (found.finding, found.failure, found.pick) == (False, None, None)


def test_an_album_written_alike_in_other_letters_shares_what_was_found(
    enriching: Enriching, alice: Account
) -> None:
    _found(enriching, alice)

    shared = enriching.album_covers.covers(alice, " help! ", "THE BEATLES")

    assert [each.option.release_id for each in shared.covers] == [HELP_VINYL, HELP_CD]


def test_an_album_is_keyed_as_the_page_groups_it_katakana_as_hiragana() -> None:
    assert album_key("アルバム", "ヨアソビ") == album_key(" あるばむ ", "よあそび")


def test_an_album_is_keyed_as_the_page_groups_it_lower_cased_not_case_folded() -> None:
    assert album_key("STRASSE", "") == album_key("strasse", "")
    assert album_key("Straße", "") != album_key("Strasse", "")


def test_an_album_by_an_artist_linked_to_musicbrainz_is_searched_by_that_artist(
    enriching: Enriching, alice: Account
) -> None:
    enriching.add_song("Ticket to Ride", artist="披头士", album="Help!")
    enriching.artists.look_up(alice, ["披头士"])
    enriching.finish_every_job()
    enriching.artists.link(alice, "披头士", BEATLES)

    enriching.album_covers.find(alice, "Help!", "披头士")
    enriching.finish_every_job()

    found = enriching.album_covers.covers(alice, "Help!", "披头士")
    assert [each.option.release_id for each in found.covers] == [HELP_VINYL, HELP_CD]


def _cover_of(found: AlbumCovers, release_id: str) -> str:
    return next(each.cover for each in found.covers if each.option.release_id == release_id)


def test_the_first_cover_found_whose_title_and_artist_are_the_albums_is_suggested(
    enriching: Enriching, alice: Account
) -> None:
    found = _found(enriching, alice)

    assert found.suggested == _cover_of(found, HELP_VINYL)


def test_the_cover_an_ai_model_picked_is_suggested(enriching: Enriching, alice: Account) -> None:
    _found(enriching, alice)

    chosen = _chosen(enriching, alice)

    assert chosen.suggested == _cover_of(chosen, HELP_CD)


def test_a_cover_found_by_a_linked_artists_name_is_suggested(
    enriching: Enriching, alice: Account
) -> None:
    enriching.add_song("Ticket to Ride", artist="披头士", album="Help!")
    enriching.artists.look_up(alice, ["披头士"])
    enriching.finish_every_job()
    enriching.artists.link(alice, "披头士", BEATLES)
    enriching.album_covers.find(alice, "Help!", "披头士")
    enriching.finish_every_job()

    found = enriching.album_covers.covers(alice, "Help!", "披头士")

    assert found.suggested == _cover_of(found, HELP_VINYL)


def test_a_dismissed_cover_is_suggested_no_more_even_once_found_again(
    enriching: Enriching, alice: Account
) -> None:
    found = _found(enriching, alice)

    enriching.album_covers.dismiss(alice, "Help!", "The Beatles", _cover_of(found, HELP_VINYL))
    again = _found(enriching, alice)

    assert again.suggested == _cover_of(again, HELP_CD)


def test_dismissing_a_cover_not_found_for_the_album_is_refused(
    enriching: Enriching, alice: Account
) -> None:
    _found(enriching, alice)

    with pytest.raises(InvalidInputError):
        enriching.album_covers.dismiss(alice, "Help!", "The Beatles", "0" * 64)


def test_an_album_never_searched_is_due_a_search_musicbrainz_may_answer(
    enriching: Enriching, alice: Account
) -> None:
    known = enriching.album_covers.covers(alice, "Help!", "The Beatles")

    assert (known.due, known.may_find) == (True, True)


def test_an_album_whose_covers_were_found_is_not_due_a_search(
    enriching: Enriching, alice: Account
) -> None:
    assert not _found(enriching, alice).due


def test_an_album_searched_in_vain_is_due_again_after_30_days(
    enriching: Enriching, alice: Account
) -> None:
    enriching.album_covers.find(alice, "Rubber Soul", "The Beatles")
    enriching.finish_every_job()
    soon = enriching.album_covers.covers(alice, "Rubber Soul", "The Beatles")

    enriching.clock.advance(timedelta(days=30, seconds=1))
    later = enriching.album_covers.covers(alice, "Rubber Soul", "The Beatles")

    assert (soon.due, later.due) == (False, True)


def test_nothing_is_known_of_an_albums_covers_until_asked(
    enriching: Enriching, alice: Account
) -> None:
    known = enriching.album_covers.covers(alice, "Help!", "The Beatles")

    assert (known.covers, known.found_at, known.finding, known.may_choose) == (
        (),
        None,
        False,
        False,
    )


def test_musicbrainz_refusing_fails_the_finding_saying_so(
    enriching: Enriching, alice: Account
) -> None:
    found = _found(enriching, alice, album="Refuse")

    assert found.covers == ()
    assert found.failure is not None
    assert "refused" in found.failure


def test_a_cover_that_is_no_image_is_left_out(enriching: Enriching, alice: Account) -> None:
    found = _found(enriching, alice, album="Forged")

    assert (found.covers, found.failure) == ((), None)


def test_an_ai_model_picks_the_release_that_fits_with_why_and_who_answered(
    enriching: Enriching, alice: Account
) -> None:
    assert _found(enriching, alice).may_choose

    chosen = _chosen(enriching, alice)

    assert chosen.pick is not None
    assert (chosen.pick.release_id, chosen.pick.why, chosen.pick.model, chosen.pick.host) == (
        HELP_CD,
        "The CD, by its songs",
        "deepseek-flash",
        "api.deepseek.com",
    )
    assert (chosen.choosing, chosen.may_choose) == (False, False)


def test_the_model_is_shown_the_releases_and_a_few_of_the_albums_songs(
    enriching: Enriching, alice: Account
) -> None:
    _found(enriching, alice)

    _chosen(enriching, alice)

    with enriching.units() as db:
        asked = db.scalars(select(JobRow.request).where(JobRow.kind == "choose_cover")).one()
    request = ChooseCoverJob.model_validate(asked)
    assert request.songs == ("Help!", "Yesterday")
    assert [option.release_id for option in request.options] == [HELP_VINYL, HELP_CD]


def test_asking_again_once_a_model_picked_among_the_covers_found_asks_nothing(
    enriching: Enriching, alice: Account
) -> None:
    _found(enriching, alice)
    _chosen(enriching, alice)

    _chosen(enriching, alice)

    assert _jobs_of(enriching, "choose_cover") == 1


def test_finding_again_forgets_the_pick_among_the_covers_found_before(
    enriching: Enriching, alice: Account
) -> None:
    _found(enriching, alice)
    _chosen(enriching, alice)

    found = _found(enriching, alice)

    assert (found.pick, found.may_choose) == (None, True)


def test_asking_which_fits_before_the_covers_are_found_is_refused(
    enriching: Enriching, alice: Account
) -> None:
    with pytest.raises(ConflictError, match="Find the album's covers"):
        enriching.album_covers.choose(alice, "Help!", "The Beatles")


def test_an_album_with_no_name_is_refused(enriching: Enriching, alice: Account) -> None:
    with pytest.raises(InvalidInputError):
        enriching.album_covers.find(alice, "  ", "The Beatles")


def test_the_sweep_keeps_the_covers_found_for_an_album(
    enriching: Enriching, alice: Account
) -> None:
    found = _found(enriching, alice)

    enriching.covers.sweep()

    covers = enriching.data_dir / COVERS_FOLDER
    assert all((covers / each.cover).is_file() for each in found.covers)


def _cover_search(
    enriching: Enriching, alice: Account, search: CoverSearch, *, pick_by_ai: bool = False
) -> None:
    """Have albums with no cover searched as `search` says, and picked by AI if `pick_by_ai`."""
    settings = SettingsService(enriching.units, enriching.clock)
    settings.put(
        alice,
        replace(settings.get(), find_album_covers=search, pick_album_covers_by_ai=pick_by_ai),
    )


def _songs_of(enriching: Enriching, album: str) -> list[TrackId]:
    with enriching.units() as db:
        ids = select(TrackRow.id).where(TrackRow.album == album).order_by(TrackRow.id)
        return [TrackId(each) for each in db.scalars(ids)]


def _covers_shown(enriching: Enriching, album: str) -> list[str | None]:
    with enriching.units() as db:
        shown = select(TrackRow.cover).where(TrackRow.album == album).order_by(TrackRow.id)
        return list(db.scalars(shown))


def _searches(enriching: Enriching) -> list[dict[str, object]]:
    """Return the request of every search for an album's covers, oldest first."""
    with enriching.units() as db:
        rows = select(JobRow.request).where(JobRow.kind == FIND_COVERS_KIND).order_by(JobRow.id)
        return list(db.scalars(rows))


def _rubber_soul(enriching: Enriching, songs: int) -> list[TrackId]:
    """Add *Rubber Soul* by The Beatles with `songs` songs; MusicBrainz finds nothing for it."""
    return [
        enriching.add_song(f"Rubber Soul {place}", artist="The Beatles", album="Rubber Soul")
        for place in range(1, songs + 1)
    ]


def test_an_album_with_no_cover_is_listed_with_its_songs_until_searched(
    enriching: Enriching,
) -> None:
    missing = enriching.album_covers.missing()

    assert missing == (
        MissingCover(
            album="Help!",
            artist="The Beatles",
            songs=2,
            suggested=None,
            picked=False,
            found=False,
            finding=False,
        ),
    )


def test_an_album_one_of_whose_songs_shows_a_cover_is_not_listed(enriching: Enriching) -> None:
    enriching.covers.set_cover(_songs_of(enriching, "Help!")[0], jpeg_image("Help! from a file"))

    assert enriching.album_covers.missing() == ()


def test_songs_with_no_album_are_no_album_to_list(enriching: Enriching) -> None:
    enriching.add_song("Something", artist="The Beatles")

    assert [each.album for each in enriching.album_covers.missing()] == ["Help!"]


def test_an_album_with_a_suggested_cover_is_listed_before_albums_with_more_songs(
    enriching: Enriching, alice: Account
) -> None:
    _rubber_soul(enriching, 3)
    found = _found(enriching, alice)

    missing = enriching.album_covers.missing()

    assert [(each.album, each.songs, each.suggested) for each in missing] == [
        ("Help!", 2, _cover_of(found, HELP_VINYL)),
        ("Rubber Soul", 3, None),
    ]


def test_the_songs_of_an_album_that_is_one_file_are_listed_without_the_file(
    enriching: Enriching,
) -> None:
    _live_file(enriching)

    live = next(each for each in enriching.album_covers.missing() if each.album == "Live")

    assert (live.artist, live.songs) == ("The Beatles", 2)


def _live_file(enriching: Enriching) -> TrackId:
    """Add the album *Live* by The Beatles as one file, split into two songs."""
    file = enriching.add_song("Live", artist="The Beatles", album="Live", duration_ms=40 * 60_000)
    SongsService(enriching.units, enriching.clock).save(
        file, [SongRow(None, Song(0, "Twist and Shout")), SongRow(None, Song(150_000, "Help!"))]
    )
    return file


def test_using_the_suggested_cover_puts_it_on_every_song_of_the_album(
    enriching: Enriching, alice: Account
) -> None:
    cover = _cover_of(_found(enriching, alice), HELP_VINYL)

    used = enriching.album_covers.use(alice, [ChosenAlbumCover("Help!", "The Beatles", cover)])

    assert used == 1
    assert _covers_shown(enriching, "Help!") == [cover, cover]
    assert enriching.album_covers.missing() == ()


def _searched(enriching: Enriching, album: str, artist: str, image: bytes) -> str:
    """Record that MusicBrainz found `image` as the front cover of a release of the album.

    Return the cover it is kept as.
    """
    cover = cover_id(image)
    keep_cover(enriching.data_dir / COVERS_FOLDER, cover, image)
    with enriching.units.begin() as db:
        db.add(
            AlbumCoverSearchRow(
                key=album_key(album, artist),
                finder="musicbrainz",
                album=album,
                artist=artist,
                covers=[{"option": {"release_id": HELP_CD, "title": album}, "cover": cover}],
                found_at=enriching.clock(),
            )
        )
    return cover


def test_using_a_cover_on_an_album_that_is_one_file_puts_it_on_the_file(
    enriching: Enriching, alice: Account
) -> None:
    file = _live_file(enriching)
    cover = _searched(enriching, "Live", "The Beatles", jpeg_image("Live 1963"))

    used = enriching.album_covers.use(alice, [ChosenAlbumCover("Live", "The Beatles", cover)])

    with enriching.units() as db:
        shown_on_file = db.get_one(TrackRow, file).cover
    assert (used, shown_on_file) == (1, cover)
    assert set(_covers_shown(enriching, "Live")) == {cover}


def test_using_a_cover_on_an_album_that_gained_one_meanwhile_changes_nothing(
    enriching: Enriching, alice: Account
) -> None:
    cover = _cover_of(_found(enriching, alice), HELP_VINYL)
    first, _second = _songs_of(enriching, "Help!")
    own = enriching.covers.set_cover(first, jpeg_image("Help! from a file"))

    used = enriching.album_covers.use(alice, [ChosenAlbumCover("Help!", "The Beatles", cover)])

    assert used == 0
    assert _covers_shown(enriching, "Help!") == [own, None]


def test_using_a_cover_not_found_for_the_album_is_refused_and_uses_none(
    enriching: Enriching, alice: Account
) -> None:
    cover = _cover_of(_found(enriching, alice), HELP_VINYL)
    _rubber_soul(enriching, 1)

    with pytest.raises(InvalidInputError, match="found"):
        enriching.album_covers.use(
            alice,
            [
                ChosenAlbumCover("Help!", "The Beatles", cover),
                ChosenAlbumCover("Rubber Soul", "The Beatles", cover),
            ],
        )

    assert _covers_shown(enriching, "Help!") == [None, None]


def test_the_albums_of_the_song_playing_and_the_next_are_searched_trying_four_releases(
    enriching: Enriching, alice: Account
) -> None:
    help_songs = _songs_of(enriching, "Help!")
    soul = _rubber_soul(enriching, 1)
    later = enriching.add_song("Taxman", artist="The Beatles", album="Revolver")

    asked = enriching.album_covers.find_missing(alice, [help_songs[0], *soul, later])

    assert asked == 2
    assert [(each["album"], each["tried"]) for each in _searches(enriching)] == [
        ("Help!", 4),
        ("Rubber Soul", 4),
    ]


def test_an_album_up_next_searched_before_is_not_searched_again(
    enriching: Enriching, alice: Account
) -> None:
    _found(enriching, alice)

    asked = enriching.album_covers.find_missing(alice, _songs_of(enriching, "Help!"))

    assert asked == 0


def test_no_album_up_next_is_searched_while_the_household_has_none_searched(
    enriching: Enriching, alice: Account
) -> None:
    _cover_search(enriching, alice, CoverSearch.OFF)

    assert enriching.album_covers.find_missing(alice, _songs_of(enriching, "Help!")) == 0


def test_an_album_under_several_artists_with_no_album_artist_is_not_searched_on_its_own(
    enriching: Enriching, alice: Account
) -> None:
    mix = enriching.add_song("One", artist="U2", album="Now 1")
    enriching.add_song("Two", artist="Blur", album="Now 1")

    assert enriching.album_covers.find_missing(alice, [mix]) == 0


def test_under_every_missing_the_sweep_searches_one_album_while_musicbrainz_is_idle(
    enriching: Enriching, alice: Account
) -> None:
    _rubber_soul(enriching, 1)
    _cover_search(enriching, alice, CoverSearch.MISSING)

    first = enriching.album_covers.sweep()
    while_searching = enriching.album_covers.sweep()
    enriching.finish_every_job()
    second = enriching.album_covers.sweep()
    enriching.finish_every_job()
    none_left = enriching.album_covers.sweep()

    assert (first, while_searching, second, none_left) == (1, 0, 1, 0)
    assert [each["tried"] for each in _searches(enriching)] == [4, 4]


def test_the_sweep_searches_the_albums_coming_up_first_then_those_with_most_songs(
    enriching: Enriching, alice: Account
) -> None:
    _rubber_soul(enriching, 3)
    revolver = enriching.add_song("Taxman", artist="The Beatles", album="Revolver")
    help_songs = _songs_of(enriching, "Help!")
    _cover_search(enriching, alice, CoverSearch.MISSING)
    enriching.album_covers.find_missing(alice, [*help_songs, revolver])
    enriching.finish_every_job()

    enriching.album_covers.sweep()
    enriching.finish_every_job()
    enriching.album_covers.sweep()

    assert [each["album"] for each in _searches(enriching)] == ["Help!", "Revolver", "Rubber Soul"]


def test_the_sweep_searches_nothing_while_only_the_albums_up_next_are_searched(
    enriching: Enriching,
) -> None:
    assert enriching.album_covers.sweep() == 0


def test_the_sweep_has_an_ai_model_pick_when_no_cover_found_fits_and_the_household_wants_it(
    enriching: Enriching, alice: Account
) -> None:
    enriching.add_song("Help Me", artist="The Beatles", album="Help Me")
    enriching.album_covers.find(alice, "Help Me", "The Beatles")
    enriching.finish_every_job()
    unfit = enriching.album_covers.covers(alice, "Help Me", "The Beatles")
    _cover_search(enriching, alice, CoverSearch.UP_NEXT, pick_by_ai=True)

    asked = enriching.album_covers.sweep()
    enriching.finish_every_job()

    picked = enriching.album_covers.covers(alice, "Help Me", "The Beatles")
    assert (unfit.suggested, asked) == (None, 1)
    assert picked.pick is not None
    assert picked.suggested == _cover_of(picked, picked.pick.release_id)


def test_the_sweep_has_no_model_pick_where_a_cover_found_fits(
    enriching: Enriching, alice: Account
) -> None:
    _found(enriching, alice)
    _cover_search(enriching, alice, CoverSearch.UP_NEXT, pick_by_ai=True)

    assert enriching.album_covers.sweep() == 0


def test_the_sweep_has_no_model_pick_unless_the_household_wants_it(
    enriching: Enriching, alice: Account
) -> None:
    enriching.add_song("Help Me", artist="The Beatles", album="Help Me")
    enriching.album_covers.find(alice, "Help Me", "The Beatles")
    enriching.finish_every_job()

    assert enriching.album_covers.sweep() == 0


def test_the_sweep_lets_go_of_covers_found_for_an_album_with_a_cover_once_a_day_old(
    enriching: Enriching, alice: Account
) -> None:
    _found(enriching, alice)
    enriching.covers.set_cover(_songs_of(enriching, "Help!")[0], jpeg_image("Help! from a file"))

    enriching.album_covers.sweep()
    kept_that_day = enriching.album_covers.covers(alice, "Help!", "The Beatles").covers
    enriching.clock.advance(timedelta(days=1, seconds=1))
    enriching.album_covers.sweep()
    later = enriching.album_covers.covers(alice, "Help!", "The Beatles")

    assert len(kept_that_day) == 2
    assert (later.covers, later.found_at) == ((), None)
