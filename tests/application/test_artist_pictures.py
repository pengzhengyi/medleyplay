"""Pictures of an artist found on Deezer, to choose the household's photo of it from.

Deezer is asked only once the household turns it on, by the artist's name, in a Job of
its own lane; what it finds is kept as covers are, and nothing changes the artist's
photo until the household uses one.
"""

from collections.abc import Iterator
from dataclasses import replace
from pathlib import Path

import pytest
from sqlalchemy import delete, select
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.accounts import AccountService
from medleyplay.application.artist_pictures import ArtistPictures, MissingPhoto
from medleyplay.application.covers import COVERS_FOLDER
from medleyplay.application.settings import SettingsService
from medleyplay.domain.accounts import Account
from medleyplay.domain.artists import PictureSite
from medleyplay.domain.errors import ConflictError, InvalidInputError, NotFoundError
from medleyplay.domain.settings import PhotoSearch, Settings
from medleyplay.persistence.schema import ArtistAliasRow, ArtistRow, JobRow, TrackRow
from medleyplay.programs.find_pictures import ChoosePictureJob
from tests.support.ai import DEEPSEEK
from tests.support.enrichment import Enriching, running_enrichment
from tests.support.factories import NewAccountFactory
from tests.support.fakes import FakeClock

BEATLES = "b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d"


@pytest.fixture
def alice(accounts: AccountService) -> Account:
    return accounts.create_first_admin(NewAccountFactory.admin()).account


@pytest.fixture
def enriching(
    units: sessionmaker[Session], clock: FakeClock, tmp_path: Path, alice: Account
) -> Iterator[Enriching]:
    """The Library with 披头士 linked to The Beatles, which Deezer knows by that name."""
    with running_enrichment(units, clock, tmp_path / "data") as running:
        running.add_song("Yesterday", artist="披头士")
        running.artists.look_up(alice, ["披头士"])
        running.finish_every_job()
        running.artists.link(alice, "披头士", BEATLES)
        running.finish_every_job()
        yield running


def _deezer_turned_on(enriching: Enriching, alice: Account) -> None:
    settings = SettingsService(enriching.units, enriching.clock)
    settings.put(alice, Settings(picture_sites=(PictureSite.DEEZER,)))


def _found(enriching: Enriching, alice: Account) -> ArtistPictures:
    """Turn Deezer on, set DeepSeek up, and find The Beatles' pictures."""
    _deezer_turned_on(enriching, alice)
    enriching.ai.add(alice, DEEPSEEK, "deepseek-flash", None)
    enriching.artist_pictures.find(alice, BEATLES)
    enriching.finish_every_job()
    return enriching.artist_pictures.pictures(alice, BEATLES)


def _chosen(enriching: Enriching, alice: Account, hint: str = "") -> ArtistPictures:
    """Ask a model which of The Beatles' pictures is of them, and return what it picked."""
    enriching.artist_pictures.choose(alice, BEATLES, hint)
    enriching.finish_every_job()
    return enriching.artist_pictures.pictures(alice, BEATLES)


def _choices_asked(enriching: Enriching) -> list[ChoosePictureJob]:
    with enriching.units() as db:
        asked = db.scalars(select(JobRow.request).where(JobRow.kind == "choose_picture")).all()
    return [ChoosePictureJob.model_validate(each) for each in asked]


def test_the_pictures_deezer_has_of_an_artist_are_found_and_kept_most_followed_first(
    enriching: Enriching, alice: Account
) -> None:
    _deezer_turned_on(enriching, alice)

    enriching.artist_pictures.find(alice, BEATLES)
    enriching.finish_every_job()

    found = enriching.artist_pictures.pictures(alice, BEATLES)
    assert [(each.name, each.fans) for each in found.pictures] == [
        ("The Beatles", 4_100_000),
        ("The Beatles", 120),
    ]
    assert all((enriching.data_dir / "covers" / each.cover).is_file() for each in found.pictures)
    assert (found.finding, found.failure, found.found_at is not None) == (False, None, True)


def test_a_picture_found_becomes_the_households_photo_only_when_used(
    enriching: Enriching, alice: Account
) -> None:
    _deezer_turned_on(enriching, alice)
    enriching.artist_pictures.find(alice, BEATLES)
    enriching.finish_every_job()
    picture = enriching.artist_pictures.pictures(alice, BEATLES).pictures[1]
    before = enriching.artists.names().artists[BEATLES].own_photo

    enriching.artists.use_photo(BEATLES, picture.cover)

    beatles = enriching.artists.names().artists[BEATLES]
    assert (before, beatles.own_photo, beatles.photo) == (False, True, picture.cover)


def test_deezer_is_never_asked_until_the_household_turns_it_on(
    enriching: Enriching, alice: Account
) -> None:
    with pytest.raises(ConflictError, match="Turn on Deezer"):
        enriching.artist_pictures.find(alice, BEATLES)

    found = enriching.artist_pictures.pictures(alice, BEATLES)
    assert (found.may_find, found.pictures, found.finding) == (False, (), False)


def test_deezer_refusing_says_why_to_the_account_that_asked(
    enriching: Enriching, alice: Account
) -> None:
    _deezer_turned_on(enriching, alice)
    enriching.artists.set_details(BEATLES, shown_as="Refuse", about="")

    enriching.artist_pictures.find(alice, BEATLES)
    enriching.finish_every_job()

    found = enriching.artist_pictures.pictures(alice, BEATLES)
    assert found.pictures == ()
    assert found.failure is not None
    assert "Deezer refused" in found.failure


def test_an_artist_no_site_named_has_no_pictures_to_find(
    enriching: Enriching, alice: Account
) -> None:
    _deezer_turned_on(enriching, alice)

    with pytest.raises(NotFoundError):
        enriching.artist_pictures.find(alice, "00000000-0000-4000-8000-000000000000")


def test_an_ai_model_picks_the_picture_of_the_artist_with_why_and_who_answered(
    enriching: Enriching, alice: Account
) -> None:
    found = _found(enriching, alice)
    assert (found.may_choose, found.pick) == (True, None)

    chosen = _chosen(enriching, alice)

    assert chosen.pick is not None
    assert (chosen.pick.cover, chosen.pick.why, chosen.pick.model, chosen.pick.host) == (
        found.pictures[0].cover,
        "The most followed",
        "deepseek-flash",
        "api.deepseek.com",
    )
    assert chosen.choosing is False


def test_the_model_is_shown_the_artist_its_other_names_its_songs_and_each_picture(
    enriching: Enriching, alice: Account
) -> None:
    _found(enriching, alice)

    _chosen(enriching, alice, "the band, not a tribute")

    [asked] = _choices_asked(enriching)
    assert (asked.artist, asked.about, asked.hint) == (
        "The Beatles",
        "GB",
        "the band, not a tribute",
    )
    assert "披头士" in asked.other_names
    assert asked.songs == ("Yesterday",)
    assert [(each.name, each.fans) for each in asked.options] == [
        ("The Beatles", 4_100_000),
        ("The Beatles", 120),
    ]


def test_asking_again_with_another_note_asks_again_and_keeps_the_note(
    enriching: Enriching, alice: Account
) -> None:
    found = _found(enriching, alice)
    _chosen(enriching, alice)

    again = _chosen(enriching, alice, "the  tribute act")

    assert again.pick is not None
    assert (again.pick.cover, again.pick.hint) == (found.pictures[1].cover, "the tribute act")


def test_asking_again_with_the_same_note_asks_nothing(enriching: Enriching, alice: Account) -> None:
    _found(enriching, alice)
    _chosen(enriching, alice, "the band")

    _chosen(enriching, alice, "the band")

    assert len(_choices_asked(enriching)) == 1


def test_finding_again_forgets_the_pick_among_the_pictures_found_before(
    enriching: Enriching, alice: Account
) -> None:
    _found(enriching, alice)
    _chosen(enriching, alice)

    enriching.artist_pictures.find(alice, BEATLES)
    enriching.finish_every_job()

    assert enriching.artist_pictures.pictures(alice, BEATLES).pick is None


def test_the_ai_provider_refusing_says_why_and_picks_nothing(
    enriching: Enriching, alice: Account
) -> None:
    _found(enriching, alice)

    chosen = _chosen(enriching, alice, "Refuse")

    assert chosen.pick is None
    assert chosen.choice_failure is not None
    assert "refused" in chosen.choice_failure


def test_asking_which_picture_before_any_is_found_is_refused(
    enriching: Enriching, alice: Account
) -> None:
    enriching.ai.add(alice, DEEPSEEK, "deepseek-flash", None)

    with pytest.raises(ConflictError, match="Find the artist's pictures"):
        enriching.artist_pictures.choose(alice, BEATLES)


def test_no_model_may_be_asked_until_an_ai_provider_is_set_up(
    enriching: Enriching, alice: Account
) -> None:
    _deezer_turned_on(enriching, alice)
    enriching.artist_pictures.find(alice, BEATLES)
    enriching.finish_every_job()

    with pytest.raises(ConflictError, match="Set up an AI provider"):
        enriching.artist_pictures.choose(alice, BEATLES)
    assert enriching.artist_pictures.pictures(alice, BEATLES).may_choose is False


def test_a_note_too_long_for_the_ai_is_refused(enriching: Enriching, alice: Account) -> None:
    _found(enriching, alice)

    with pytest.raises(InvalidInputError):
        enriching.artist_pictures.choose(alice, BEATLES, "x" * 501)


def test_the_picture_suggested_is_the_most_followed_going_by_the_artists_name(
    enriching: Enriching, alice: Account
) -> None:
    found = _found(enriching, alice)

    assert found.suggested == found.pictures[0].cover


def test_the_picture_an_ai_model_picked_is_the_one_suggested(
    enriching: Enriching, alice: Account
) -> None:
    found = _found(enriching, alice)

    chosen = _chosen(enriching, alice, "the tribute act")

    assert chosen.suggested == found.pictures[1].cover


def test_no_picture_is_suggested_when_none_goes_by_the_artists_names(
    enriching: Enriching, alice: Account
) -> None:
    _found(enriching, alice)

    with enriching.units.begin() as db:
        renamed = db.get_one(ArtistRow, BEATLES)
        renamed.name, renamed.sort_name = "Queen", "Queen"
        db.execute(delete(ArtistAliasRow).where(ArtistAliasRow.artist_id == BEATLES))

    found = enriching.artist_pictures.pictures(alice, BEATLES)
    assert (len(found.pictures), found.suggested) == (2, None)


def test_a_picture_dismissed_is_suggested_no_more_and_the_next_likeliest_is(
    enriching: Enriching, alice: Account
) -> None:
    found = _found(enriching, alice)

    enriching.artist_pictures.dismiss(alice, BEATLES, found.pictures[0].cover)

    again = enriching.artist_pictures.pictures(alice, BEATLES)
    assert (again.pictures, again.suggested) == (found.pictures, found.pictures[1].cover)


def test_an_ai_pick_dismissed_is_suggested_no_more(enriching: Enriching, alice: Account) -> None:
    found = _found(enriching, alice)
    _chosen(enriching, alice, "the tribute act")

    enriching.artist_pictures.dismiss(alice, BEATLES, found.pictures[1].cover)

    assert enriching.artist_pictures.pictures(alice, BEATLES).suggested == found.pictures[0].cover


def test_with_every_picture_dismissed_none_is_suggested_even_when_found_again(
    enriching: Enriching, alice: Account
) -> None:
    found = _found(enriching, alice)
    _photo_dropped(enriching)

    for picture in found.pictures:
        enriching.artist_pictures.dismiss(alice, BEATLES, picture.cover)
    enriching.artist_pictures.find(alice, BEATLES)
    enriching.finish_every_job()

    [missing] = enriching.artist_pictures.missing()
    assert enriching.artist_pictures.pictures(alice, BEATLES).suggested is None
    assert missing.suggested is None


def test_only_a_picture_found_of_the_artist_may_be_dismissed(
    enriching: Enriching, alice: Account
) -> None:
    _found(enriching, alice)

    with pytest.raises(InvalidInputError, match="found"):
        enriching.artist_pictures.dismiss(alice, BEATLES, "0" * 64 + ".jpg")


def _photo_search(enriching: Enriching, alice: Account, search: PhotoSearch) -> None:
    """Turn Deezer on, with the artists with no photo looked up as `search` says."""
    settings = SettingsService(enriching.units, enriching.clock)
    settings.put(
        alice,
        replace(settings.get(), picture_sites=(PictureSite.DEEZER,), find_artist_photos=search),
    )


def _photo_dropped(enriching: Enriching) -> None:
    """Drop the photo Wikidata gave The Beatles, so they have none."""
    with enriching.units.begin() as db:
        db.get_one(ArtistRow, BEATLES).photo = None


def _song(enriching: Enriching) -> int:
    with enriching.units() as db:
        return db.scalars(select(TrackRow.id)).one()


def test_an_artist_with_no_photo_is_listed_with_its_songs_until_looked_up(
    enriching: Enriching,
) -> None:
    _photo_dropped(enriching)

    missing = enriching.artist_pictures.missing()

    assert missing == (
        MissingPhoto(
            artist_id=BEATLES,
            name="The Beatles",
            songs=1,
            suggested=None,
            picked=False,
            found=False,
            finding=False,
        ),
    )


def test_an_artist_with_a_photo_is_not_listed(enriching: Enriching) -> None:
    assert enriching.artist_pictures.missing() == ()


def test_the_artists_of_the_songs_up_next_are_looked_up_and_their_photo_suggested(
    enriching: Enriching, alice: Account
) -> None:
    _photo_dropped(enriching)
    _photo_search(enriching, alice, PhotoSearch.UP_NEXT)

    asked = enriching.artist_pictures.find_missing(alice, [_song(enriching)])
    enriching.finish_every_job()

    [missing] = enriching.artist_pictures.missing()
    found = enriching.artist_pictures.pictures(alice, BEATLES)
    assert asked == 1
    assert (missing.found, missing.suggested) == (True, found.pictures[0].cover)


def test_an_artist_looked_up_before_is_not_looked_up_again(
    enriching: Enriching, alice: Account
) -> None:
    _photo_dropped(enriching)
    _photo_search(enriching, alice, PhotoSearch.UP_NEXT)
    enriching.artist_pictures.find_missing(alice, [_song(enriching)])
    enriching.finish_every_job()

    assert enriching.artist_pictures.find_missing(alice, [_song(enriching)]) == 0


def test_every_artist_is_looked_up_only_while_the_household_has_every_one_looked_up(
    enriching: Enriching, alice: Account
) -> None:
    _photo_dropped(enriching)
    _photo_search(enriching, alice, PhotoSearch.UP_NEXT)
    before = enriching.artist_pictures.find_missing(alice, None)
    _photo_search(enriching, alice, PhotoSearch.MISSING)

    after = enriching.artist_pictures.find_missing(alice, None)

    assert (before, after) == (0, 1)


def test_no_artist_is_looked_up_on_its_own_while_the_household_has_none_looked_up(
    enriching: Enriching, alice: Account
) -> None:
    _photo_dropped(enriching)
    _photo_search(enriching, alice, PhotoSearch.OFF)

    assert enriching.artist_pictures.find_missing(alice, [_song(enriching)]) == 0


def test_no_artist_is_looked_up_on_its_own_while_deezer_is_off(
    enriching: Enriching, alice: Account
) -> None:
    _photo_dropped(enriching)

    assert enriching.artist_pictures.find_missing(alice, [_song(enriching)]) == 0


def test_the_sweep_keeps_the_pictures_found_of_an_artist(
    enriching: Enriching, alice: Account
) -> None:
    found = _found(enriching, alice)

    enriching.covers.sweep()

    covers = enriching.data_dir / COVERS_FOLDER
    assert all((covers / each.cover).is_file() for each in found.pictures)


def test_pictures_whose_files_are_gone_are_forgotten_so_the_artist_is_looked_up_again(
    enriching: Enriching, alice: Account
) -> None:
    found = _found(enriching, alice)
    (enriching.data_dir / COVERS_FOLDER / found.pictures[0].cover).unlink()

    enriching.covers.sweep()

    forgotten = enriching.artist_pictures.pictures(alice, BEATLES)
    assert (forgotten.pictures, forgotten.found_at, forgotten.suggested) == ((), None, None)
