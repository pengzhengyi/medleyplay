"""An album's covers: the front covers of its releases MusicBrainz knows, and an AI model's pick.

Nothing changes the album's cover until the household chooses one; what is found is
kept, and finding again replaces it.
"""

from collections.abc import Iterator
from datetime import timedelta
from pathlib import Path

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.accounts import AccountService
from medleyplay.application.album_covers import AlbumCovers, album_key
from medleyplay.application.covers import COVERS_FOLDER
from medleyplay.domain.accounts import Account
from medleyplay.domain.errors import ConflictError, InvalidInputError
from medleyplay.persistence.schema import JobRow
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


def test_an_album_never_searched_is_due_a_search(enriching: Enriching, alice: Account) -> None:
    assert enriching.album_covers.covers(alice, "Help!", "The Beatles").due


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
