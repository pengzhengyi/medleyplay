"""Links to pictures an AI model suggests, and the one the household approves, fetched.

Nothing is fetched until someone approves a link the model named; the image fetched is
kept as a cover, for the household to use as the album's cover or the artist's photo.
"""

from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application.accounts import AccountService
from medleyplay.application.album_covers import album_key
from medleyplay.application.covers import COVERS_FOLDER
from medleyplay.application.image_links import (
    AlbumPictured,
    ArtistPictured,
    PictureLinks,
    SuggestedLink,
)
from medleyplay.domain.accounts import Account
from medleyplay.domain.covers import cover_id
from medleyplay.domain.errors import ConflictError, NotFoundError
from medleyplay.persistence.schema import ImageLinksRow
from medleyplay.plugin_api import ImageSubject
from tests.support.ai import DEEPSEEK
from tests.support.enrichment import Enriching, running_enrichment
from tests.support.factories import NewAccountFactory
from tests.support.fakes import FakeClock
from tests.support.plugins.reader import (
    BEATLES_FETCHED,
    BEATLES_LINK,
    HELP_FETCHED,
    HELP_GONE,
    HELP_LINK,
    HELP_PAGE,
)

BEATLES = "b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d"
HELP = AlbumPictured("Help!", "The Beatles")
"""The cover of *Help!* by The Beatles."""


@pytest.fixture
def alice(accounts: AccountService) -> Account:
    return accounts.create_first_admin(NewAccountFactory.admin()).account


@pytest.fixture
def enriching(
    units: sessionmaker[Session], clock: FakeClock, tmp_path: Path, alice: Account
) -> Iterator[Enriching]:
    """The Library holding *Help!* by The Beatles, a song by Beatles linked to the artist, and
    DeepSeek set up to ask."""
    with running_enrichment(units, clock, tmp_path / "data") as running:
        running.ai.add(alice, DEEPSEEK, "deepseek-flash", None)
        running.add_song("Help!", artist="The Beatles", album="Help!")
        running.add_song("Yesterday", artist="Beatles")
        running.artists.look_up(alice, ["Beatles"])
        running.finish_every_job()
        running.artists.link(alice, "Beatles", BEATLES)
        running.finish_every_job()
        yield running


def _suggested(
    enriching: Enriching, caller: Account, pictured: AlbumPictured | ArtistPictured = HELP
) -> PictureLinks:
    """Have `caller` ask for links to the picture, and return them once the model answered."""
    enriching.image_links.suggest(caller, pictured)
    enriching.finish_every_job()
    return enriching.image_links.links(caller, pictured)


def _approved(
    enriching: Enriching,
    caller: Account,
    url: str,
    pictured: AlbumPictured | ArtistPictured = HELP,
) -> SuggestedLink:
    """Have `caller` approve the link `url`, and return it once fetching ended."""
    enriching.image_links.approve(caller, pictured, url)
    enriching.finish_every_job()
    known = enriching.image_links.links(caller, pictured)
    return next(link for link in known.links if link.url == url)


def test_the_links_a_model_names_for_an_album_are_kept_with_who_named_them(
    enriching: Enriching, alice: Account
) -> None:
    suggested = _suggested(enriching, alice)

    assert [(link.url, link.page, link.why) for link in suggested.links] == [
        (HELP_LINK, HELP_PAGE, "The album's article shows it"),
        (HELP_GONE, None, ""),
    ]
    assert (suggested.model, suggested.asking, suggested.failure) == ("deepseek-flash", False, None)
    assert suggested.asked_at is not None


def test_nothing_is_fetched_until_a_link_is_approved(enriching: Enriching, alice: Account) -> None:
    suggested = _suggested(enriching, alice)

    assert [(link.cover, link.unavailable) for link in suggested.links] == [(None, ""), (None, "")]
    assert not (enriching.data_dir / COVERS_FOLDER / cover_id(HELP_FETCHED)).exists()


def test_a_link_approved_is_fetched_and_kept_as_a_cover(
    enriching: Enriching, alice: Account
) -> None:
    _suggested(enriching, alice)

    link = _approved(enriching, alice, HELP_LINK)

    assert link.cover == cover_id(HELP_FETCHED)
    assert (enriching.data_dir / COVERS_FOLDER / link.cover).read_bytes() == HELP_FETCHED


def test_approving_a_link_fetched_before_answers_with_its_cover_at_once(
    enriching: Enriching, alice: Account
) -> None:
    _suggested(enriching, alice)
    _approved(enriching, alice, HELP_LINK)

    cover = enriching.image_links.approve(alice, HELP, HELP_LINK)

    assert cover == cover_id(HELP_FETCHED)


def test_a_link_with_no_image_says_why(enriching: Enriching, alice: Account) -> None:
    _suggested(enriching, alice)

    link = _approved(enriching, alice, HELP_GONE)

    assert (link.cover, link.unavailable) == (
        None,
        "upload.wikimedia.org has no image there (404).",
    )


def test_a_link_the_model_did_not_name_is_never_fetched(
    enriching: Enriching, alice: Account
) -> None:
    _suggested(enriching, alice)

    with pytest.raises(NotFoundError):
        enriching.image_links.approve(alice, HELP, "https://example.com/elsewhere.jpg")


def test_a_link_whose_cover_was_removed_is_fetched_again(
    enriching: Enriching, alice: Account
) -> None:
    _suggested(enriching, alice)
    fetched = _approved(enriching, alice, HELP_LINK)
    assert fetched.cover is not None
    (enriching.data_dir / COVERS_FOLDER / fetched.cover).unlink()

    link = _approved(enriching, alice, HELP_LINK)

    assert link.cover == cover_id(HELP_FETCHED)


def test_an_image_fetched_for_a_link_no_longer_suggested_is_dropped(
    enriching: Enriching, alice: Account
) -> None:
    _suggested(enriching, alice)
    enriching.online.online = False
    enriching.image_links.approve(alice, HELP, HELP_LINK)
    _forget_links(enriching)

    enriching.online.online = True
    enriching.finish_every_job()

    assert enriching.image_links.links(alice, HELP).links == ()
    assert not (enriching.data_dir / COVERS_FOLDER / cover_id(HELP_FETCHED)).exists()


def test_the_links_for_an_artist_are_asked_by_its_name(
    enriching: Enriching, alice: Account
) -> None:
    beatles = ArtistPictured(BEATLES)

    suggested = _suggested(enriching, alice, beatles)
    link = _approved(enriching, alice, BEATLES_LINK, beatles)

    assert [each.url for each in suggested.links] == [BEATLES_LINK]
    assert link.cover == cover_id(BEATLES_FETCHED)


def test_a_cover_fetched_for_an_artist_becomes_its_photo_when_used(
    enriching: Enriching, alice: Account
) -> None:
    beatles = ArtistPictured(BEATLES)
    _suggested(enriching, alice, beatles)
    link = _approved(enriching, alice, BEATLES_LINK, beatles)
    assert link.cover is not None

    enriching.artists.use_photo(BEATLES, link.cover)

    known = enriching.artists.names().artists[BEATLES]
    assert (known.photo, known.own_photo) == (link.cover, True)


@pytest.mark.parametrize("cover", ["0" * 64, "../covers"], ids=["not kept", "not a cover"])
def test_a_cover_not_kept_cannot_become_a_photo(enriching: Enriching, cover: str) -> None:
    with pytest.raises(NotFoundError):
        enriching.artists.use_photo(BEATLES, cover)


def test_an_artist_no_site_named_has_no_links(enriching: Enriching, alice: Account) -> None:
    with pytest.raises(NotFoundError):
        enriching.image_links.suggest(alice, ArtistPictured("not-an-artist"))


def test_asking_without_an_ai_provider_set_up_is_refused(
    enriching: Enriching, alice: Account
) -> None:
    for provider in enriching.ai.providers(alice):
        enriching.ai.remove(alice, provider.id)

    with pytest.raises(ConflictError, match="Set up an AI provider"):
        enriching.image_links.suggest(alice, HELP)

    assert not enriching.image_links.links(alice, HELP).may_suggest


def test_the_provider_refusing_fails_the_asking_saying_so(
    enriching: Enriching, alice: Account
) -> None:
    enriching.add_song("Refused", artist="The Beatles", album="Help!")

    suggested = _suggested(enriching, alice)

    assert suggested.links == ()
    assert suggested.failure is not None
    assert "refused" in suggested.failure


def test_a_cover_fetched_is_kept_while_its_link_stands(
    enriching: Enriching, alice: Account
) -> None:
    _suggested(enriching, alice)
    link = _approved(enriching, alice, HELP_LINK)

    enriching.covers.sweep()

    assert link.cover is not None
    assert (enriching.data_dir / COVERS_FOLDER / link.cover).exists()


def _forget_links(enriching: Enriching) -> None:
    """Drop the links suggested for *Help!*, as a model asked again naming none would."""
    with enriching.units.begin() as db:
        row = db.get(ImageLinksRow, (ImageSubject.ALBUM.value, album_key("Help!", "The Beatles")))
        assert row is not None
        row.links = []
