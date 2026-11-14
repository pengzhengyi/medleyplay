"""The artist finder: the artists MusicBrainz knows by a name, with every name each goes by."""

from medleyplay.plugin_api import ArtistAlias, FindArtist, FindStatus
from medleyplay.plugins.musicbrainz.artists import MusicBrainzArtists
from medleyplay.plugins.musicbrainz.client import MusicBrainzClient
from tests.support.musicbrainz import API, BEATLES, FakeMusicBrainz, MusicBrainzFactory
from tests.support.transport import FakeWaits, Reply

ARTISTS = f"{API}/artist"


def finder_over(fake: FakeMusicBrainz) -> MusicBrainzArtists:
    """The finder, asking `fake` and waiting for nothing."""
    waits = FakeWaits()
    return MusicBrainzArtists(
        MusicBrainzClient(fake.session(), sleep=waits.sleep, clock=waits.clock)
    )


def test_the_artists_known_by_a_name_come_best_first_with_their_other_names() -> None:
    fake = FakeMusicBrainz().answer(ARTISTS, Reply.json(MusicBrainzFactory.beatles_search()))

    found = finder_over(fake).find(FindArtist(name="披头士"))

    beatles, tribute = found.artists
    assert (beatles.id, beatles.name, beatles.sort_name, beatles.country, beatles.score) == (
        BEATLES,
        "The Beatles",
        "Beatles, The",
        "GB",
        100,
    )
    assert ArtistAlias(name="披头士", locale="zh", primary=True) in beatles.aliases
    assert ArtistAlias(name="Beatles", locale=None, primary=False) in beatles.aliases
    assert (tribute.score, tribute.disambiguation) == (61, "Beatles tribute band")


def test_the_name_is_looked_for_among_names_and_aliases() -> None:
    fake = FakeMusicBrainz().answer(ARTISTS, Reply.json(MusicBrainzFactory.beatles_search()))

    finder_over(fake).find(FindArtist(name='AC/DC "Live"'))

    assert fake.parameter("query") == r'artist:"AC\/DC \"Live\"" OR alias:"AC\/DC \"Live\""'


def test_a_name_no_artist_goes_by_finds_none() -> None:
    fake = FakeMusicBrainz().answer(ARTISTS, Reply.json({"count": 0, "artists": []}))

    found = finder_over(fake).find(FindArtist(name="Nobody At All"))

    assert (found.status, found.artists) == (FindStatus.OK, ())


def test_musicbrainz_blocking_the_request_is_a_refusal() -> None:
    fake = FakeMusicBrainz().answer(ARTISTS, Reply(403))

    found = finder_over(fake).find(FindArtist(name="披头士"))

    assert found.status is FindStatus.REFUSED
