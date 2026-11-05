"""The MusicBrainz client keeps to the service's etiquette and sorts what it answers."""

from importlib.metadata import version

import pytest
import requests

from medleyplay.plugin_api import MAX_COVER_BYTES, NetworkError
from medleyplay.plugins.musicbrainz.client import (
    API,
    COVERS,
    MAX_ATTEMPTS,
    MAX_WAIT,
    USER_AGENT,
    MusicBrainzClient,
    RefusedError,
)
from tests.support.images import gif_image, jpeg_image, jpeg_of_size, oversized_jpeg
from tests.support.musicbrainz import (
    LET_DOWN,
    ORIGINAL,
    FakeMusicBrainz,
    FakeMusicBrainzFactory,
    FakeWaits,
    MusicBrainzFactory,
    Reply,
)

BUSY = Reply(503, {"Retry-After": "3"})
SEARCH = f"{API}/recording"
RELEASE = f"{API}/release/{ORIGINAL}"
COVER = f"{COVERS}/release/{ORIGINAL}/front-500"


def client_of(fake: FakeMusicBrainz, waits: FakeWaits | None = None) -> MusicBrainzClient:
    """A client whose requests go to `fake`, and whose waiting is `waits`'."""
    waits = waits or FakeWaits()
    return MusicBrainzClient(fake.session(), sleep=waits.sleep, clock=waits.clock)


def test_the_user_agent_names_medleyplay_its_version_and_where_to_reach_it() -> None:
    fake = FakeMusicBrainzFactory.knowing_let_down()

    client_of(fake).search_recordings('recording:"Let Down"')

    assert fake.sent[0].headers["User-Agent"] == (
        f"medleyplay/{version('medleyplay')} ( https://github.com/pengzhengyi/medleyplay )"
    )
    assert fake.sent[0].headers["User-Agent"] == USER_AGENT


def test_a_search_asks_for_json_and_names_the_query_and_a_limit() -> None:
    fake = FakeMusicBrainzFactory.knowing_let_down()

    client_of(fake).search_recordings('recording:"Let Down"')

    assert fake.urls() == [SEARCH]
    assert [fake.parameter(name) for name in ("fmt", "query", "limit")] == [
        "json",
        'recording:"Let Down"',
        "25",
    ]


def test_a_release_is_looked_up_with_its_recordings_artist_credits_media_and_genres() -> None:
    fake = FakeMusicBrainzFactory.knowing_let_down()

    client_of(fake).release(ORIGINAL)

    assert fake.urls() == [RELEASE]
    assert (fake.parameter("inc"), fake.parameter("fmt")) == (
        "recordings+artist-credits+media+genres",
        "json",
    )


def test_every_request_has_a_timeout() -> None:
    fake = FakeMusicBrainzFactory.knowing_let_down()
    client = client_of(fake)

    client.search_recordings('recording:"Let Down"')
    client.release(ORIGINAL)
    client.front_cover(ORIGINAL)

    assert len(fake.timeouts) == len(fake.sent) == 4
    assert all(isinstance(each, int | float) and 0 < each <= 30 for each in fake.timeouts)


def test_a_search_is_read_into_the_recordings_and_the_releases_they_are_on() -> None:
    fake = FakeMusicBrainzFactory.knowing_let_down()

    found = client_of(fake).search_recordings('recording:"Let Down"')

    first = found.recordings[0]
    assert (first.id, first.score, first.length, len(first.releases)) == (LET_DOWN, 100, 299266, 55)
    assert (first.releases[0].title, first.releases[0].status) == ("Paranoid Android", "Official")


def test_a_release_lookup_is_read_into_its_title_credit_and_tracks() -> None:
    fake = FakeMusicBrainzFactory.knowing_let_down()

    release = client_of(fake).release(ORIGINAL)

    assert release is not None
    assert (release.title, release.date, release.artist_credit[0].name) == (
        "OK Computer",
        "1997-05-21",
        "Radiohead",
    )
    assert release.media[0].tracks[4].title == "Let Down"
    assert release.cover_art_archive.front


def test_a_release_that_is_gone_is_none() -> None:
    fake = FakeMusicBrainz().answer(RELEASE, Reply(404))

    assert client_of(fake).release(ORIGINAL) is None


def test_two_requests_are_at_least_a_second_apart() -> None:
    waits = FakeWaits()
    fake = FakeMusicBrainzFactory.knowing_let_down()
    client = client_of(fake, waits)

    client.search_recordings('recording:"Let Down"')
    client.release(ORIGINAL)
    client.front_cover(ORIGINAL)

    assert waits.pauses == [1.0, 1.0]


def test_the_first_request_waits_for_nothing() -> None:
    waits = FakeWaits()

    client_of(FakeMusicBrainzFactory.knowing_let_down(), waits).release(ORIGINAL)

    assert waits.pauses == []


def test_a_request_after_a_second_of_other_work_waits_no_longer() -> None:
    waits = FakeWaits()
    client = client_of(FakeMusicBrainzFactory.knowing_let_down(), waits)
    client.release(ORIGINAL)

    waits.pass_time(1.0)
    client.release(ORIGINAL)

    assert waits.pauses == []


def test_a_request_after_half_a_second_waits_for_the_other_half() -> None:
    waits = FakeWaits()
    client = client_of(FakeMusicBrainzFactory.knowing_let_down(), waits)
    client.release(ORIGINAL)

    waits.pass_time(0.25)
    client.release(ORIGINAL)

    assert waits.pauses == [0.75]


def test_a_busy_answer_is_waited_out_for_as_long_as_retry_after_says_and_asked_again() -> None:
    waits = FakeWaits()
    fake = FakeMusicBrainz().answer(RELEASE, BUSY, Reply.json(MusicBrainzFactory.ok_computer()))

    release = client_of(fake, waits).release(ORIGINAL)

    assert release is not None
    assert waits.pauses == [3.0]
    assert fake.urls() == [RELEASE, RELEASE]


def test_a_busy_answer_without_retry_after_is_waited_out_for_a_couple_of_seconds() -> None:
    waits = FakeWaits()
    fake = FakeMusicBrainz().answer(
        RELEASE, Reply(503), Reply.json(MusicBrainzFactory.ok_computer())
    )

    client_of(fake, waits).release(ORIGINAL)

    assert waits.pauses == [2.0]


def test_a_busy_answer_that_never_ends_fails_as_a_network_failure_after_a_few_tries() -> None:
    waits = FakeWaits()
    fake = FakeMusicBrainz().answer(RELEASE, BUSY)

    with pytest.raises(NetworkError, match="too busy"):
        client_of(fake, waits).release(ORIGINAL)

    assert len(fake.sent) == MAX_ATTEMPTS
    assert waits.pauses == [3.0] * (MAX_ATTEMPTS - 1)


def test_a_wait_longer_than_a_job_can_give_fails_without_waiting() -> None:
    waits = FakeWaits()
    fake = FakeMusicBrainz().answer(RELEASE, Reply(503, {"Retry-After": str(MAX_WAIT + 1)}))

    with pytest.raises(NetworkError, match="too busy"):
        client_of(fake, waits).release(ORIGINAL)

    assert (len(fake.sent), waits.pauses) == (1, [])


def test_a_403_is_a_refusal() -> None:
    fake = FakeMusicBrainz().answer(SEARCH, Reply(403))

    with pytest.raises(RefusedError, match="403"):
        client_of(fake).search_recordings('recording:"Let Down"')


def test_a_refusal_is_not_asked_again() -> None:
    fake = FakeMusicBrainz().answer(SEARCH, Reply(403))

    with pytest.raises(RefusedError):
        client_of(fake).search_recordings('recording:"Let Down"')

    assert len(fake.sent) == 1


@pytest.mark.parametrize("status", [500, 502, 504])
def test_a_server_error_is_a_network_failure(status: int) -> None:
    fake = FakeMusicBrainz().answer(SEARCH, Reply(status))

    with pytest.raises(NetworkError, match=str(status)):
        client_of(fake).search_recordings('recording:"Let Down"')


@pytest.mark.parametrize(
    "failure", [requests.ConnectionError("down"), requests.Timeout("slow")], ids=["down", "slow"]
)
def test_a_connection_that_fails_is_a_network_failure(failure: Exception) -> None:
    fake = FakeMusicBrainz().answer(SEARCH, failure)

    with pytest.raises(NetworkError, match="couldn't be reached"):
        client_of(fake).search_recordings('recording:"Let Down"')


def test_an_answer_that_is_not_json_is_a_network_failure() -> None:
    """A network's sign-in page answers in place of MusicBrainz:

    ```html
    <html><body>Sign in to the café's Wi-Fi</body></html>
    ```
    """
    page = b"<html><body>Sign in to the caf\xc3\xa9's Wi-Fi</body></html>"
    fake = FakeMusicBrainz().answer(SEARCH, Reply(200, {"Content-Type": "text/html"}, page))

    with pytest.raises(NetworkError, match="not MusicBrainz"):
        client_of(fake).search_recordings('recording:"Let Down"')


def test_a_query_the_service_rejects_is_a_fault_not_a_refusal() -> None:
    fake = FakeMusicBrainz().answer(SEARCH, Reply(400))

    with pytest.raises(requests.HTTPError):
        client_of(fake).search_recordings('recording:"Let Down"')


def test_the_front_cover_is_fetched_by_following_the_archives_redirect() -> None:
    fake = FakeMusicBrainzFactory.knowing_let_down(image=jpeg_image("front"))

    image = client_of(fake).front_cover(ORIGINAL)

    assert image == jpeg_image("front")
    assert fake.urls() == [COVER, "https://archive.org/cover.jpg"]


def test_a_cover_the_archive_does_not_have_is_none() -> None:
    fake = FakeMusicBrainz().answer(COVER, Reply(404))

    assert client_of(fake).front_cover(ORIGINAL) is None


def test_a_cover_that_is_not_an_image_is_none() -> None:
    fake = FakeMusicBrainzFactory.knowing_let_down(image=gif_image())

    assert client_of(fake).front_cover(ORIGINAL) is None


def test_a_cover_larger_than_a_cover_may_be_is_none() -> None:
    fake = FakeMusicBrainzFactory.knowing_let_down(image=oversized_jpeg())

    assert client_of(fake).front_cover(ORIGINAL) is None


def test_a_cover_of_exactly_the_largest_size_is_kept() -> None:
    largest = jpeg_of_size(MAX_COVER_BYTES)
    fake = FakeMusicBrainzFactory.knowing_let_down(image=largest)

    assert client_of(fake).front_cover(ORIGINAL) == largest


def test_a_cover_that_cannot_be_fetched_is_none_not_a_failure() -> None:
    fake = FakeMusicBrainz().answer(COVER, requests.ConnectionError("down"))

    assert client_of(fake).front_cover(ORIGINAL) is None


def test_the_cover_request_waits_its_turn_like_any_other() -> None:
    waits = FakeWaits()
    client = client_of(FakeMusicBrainzFactory.knowing_let_down(), waits)
    client.release(ORIGINAL)

    client.front_cover(ORIGINAL)

    assert waits.pauses == [1.0]
