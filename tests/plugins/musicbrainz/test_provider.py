"""The musicbrainz enricher finds a Track's release, and reads it into values and a cover."""

from pathlib import Path
from typing import Any

import pytest
import requests

from medleyplay.plugin_api import (
    CommunityRating,
    EnrichStatus,
    EnrichTrack,
    NetworkError,
    RatedAs,
    ShownDetail,
)
from medleyplay.plugin_api.testing import check_track_enricher
from medleyplay.plugins.musicbrainz.client import API, MusicBrainzClient
from medleyplay.plugins.musicbrainz.provider import MusicBrainz
from tests.support.factories import EnrichTrackFactory
from tests.support.images import gif_image, jpeg_image, oversized_jpeg
from tests.support.musicbrainz import (
    LET_DOWN,
    OK_COMPUTER_GROUP,
    ORIGINAL,
    REISSUE,
    SHU_PU,
    SHU_PU_GROUP,
    FakeMusicBrainz,
    FakeMusicBrainzFactory,
    MusicBrainzFactory,
)
from tests.support.transport import FakeWaits, Reply

LET_DOWN_VALUES = {
    "title": "Let Down",
    "artist": "Radiohead",
    "album": "OK Computer",
    "album_artist": "Radiohead",
    "year": 1997,
    "track_number": 5,
    "disc_number": 1,
    "genre": "alternative rock; rock; britpop",
}


def enricher_over(fake: FakeMusicBrainz) -> MusicBrainz:
    """The enricher, asking `fake` and waiting for nothing."""
    waits = FakeWaits()
    return MusicBrainz(MusicBrainzClient(fake.session(), sleep=waits.sleep, clock=waits.clock))


def knowing_the_release(release: dict[str, Any]) -> FakeMusicBrainz:
    """A fake that finds *Let Down*, whose original release is `release`, with no cover."""
    return (
        FakeMusicBrainz()
        .answer(f"{API}/recording", Reply.json(MusicBrainzFactory.let_down_search()))
        .answer(f"{API}/release/{ORIGINAL}", Reply.json(release))
    )


def test_a_song_is_read_into_the_details_of_its_track_on_the_original_release(
    tmp_path: Path,
) -> None:
    fake = FakeMusicBrainzFactory.knowing_let_down()

    answer = enricher_over(fake).enrich(EnrichTrackFactory.let_down(tmp_path))

    assert (answer.status, answer.values) == (EnrichStatus.OK, LET_DOWN_VALUES)


def test_the_original_release_is_looked_up_rather_than_the_reissue(tmp_path: Path) -> None:
    fake = FakeMusicBrainzFactory.knowing_let_down()

    enricher_over(fake).enrich(EnrichTrackFactory.let_down(tmp_path))

    assert f"{API}/release/{ORIGINAL}" in fake.urls()
    assert f"{API}/release/{REISSUE}" not in fake.urls()


def test_the_search_is_by_the_shown_title_artist_and_album(tmp_path: Path) -> None:
    fake = FakeMusicBrainzFactory.knowing_let_down()

    enricher_over(fake).enrich(EnrichTrackFactory.let_down(tmp_path))

    assert fake.parameter("query") == (
        'recording:"Let Down" AND artist:"Radiohead" AND release:"OK Computer"'
    )


def test_an_album_that_finds_the_song_is_searched_with_once(tmp_path: Path) -> None:
    fake = FakeMusicBrainzFactory.knowing_let_down()

    enricher_over(fake).enrich(EnrichTrackFactory.let_down(tmp_path))

    assert fake.urls().count(f"{API}/recording") == 1


def test_an_album_no_release_of_the_song_is_named_is_searched_again_without_it(
    tmp_path: Path,
) -> None:
    """A video's playlist name stands where the album would be:

    ```text
    title "Let Down", artist "Radiohead", album "My Favorites 2024"
    ```
    """
    fake = (
        FakeMusicBrainz()
        .answer(
            f"{API}/recording",
            Reply.json({"recordings": []}),
            Reply.json(MusicBrainzFactory.let_down_search()),
        )
        .answer(
            f"{API}/release/{ORIGINAL}", Reply.json(MusicBrainzFactory.ok_computer(front=False))
        )
    )

    answer = enricher_over(fake).enrich(
        EnrichTrackFactory.let_down(tmp_path, album="My Favorites 2024")
    )

    assert [fake.parameter("query", index) for index in (0, 1)] == [
        'recording:"Let Down" AND artist:"Radiohead" AND release:"My Favorites 2024"',
        'recording:"Let Down" AND artist:"Radiohead"',
    ]
    assert answer.values == LET_DOWN_VALUES


def test_without_a_shown_album_the_search_names_none_and_the_earliest_release_is_chosen(
    tmp_path: Path,
) -> None:
    fake = FakeMusicBrainzFactory.knowing_let_down()

    answer = enricher_over(fake).enrich(EnrichTrackFactory.let_down(tmp_path, album=None))

    assert fake.parameter("query") == 'recording:"Let Down" AND artist:"Radiohead"'
    assert answer.values["album"] == "OK Computer"
    assert fake.urls()[1] == f"{API}/release/{ORIGINAL}"


def test_the_front_cover_is_written_into_the_folder_under_the_name_answered(
    tmp_path: Path,
) -> None:
    fake = FakeMusicBrainzFactory.knowing_let_down(image=jpeg_image("OK Computer"))

    answer = enricher_over(fake).enrich(EnrichTrackFactory.let_down(tmp_path))

    assert answer.cover is not None
    assert (tmp_path / answer.cover).read_bytes() == jpeg_image("OK Computer")


def test_a_release_without_a_front_cover_is_not_asked_for_one(tmp_path: Path) -> None:
    fake = FakeMusicBrainzFactory.knowing_let_down(front=False)

    answer = enricher_over(fake).enrich(EnrichTrackFactory.let_down(tmp_path))

    assert (answer.cover, answer.values, list(tmp_path.iterdir())) == (None, LET_DOWN_VALUES, [])
    assert not any("coverartarchive" in each for each in fake.urls())


@pytest.mark.parametrize(
    "image", [oversized_jpeg(), gif_image()], ids=["larger than a cover", "not an image"]
)
def test_a_cover_that_is_too_large_or_no_image_leaves_the_values_without_one(
    tmp_path: Path, image: bytes
) -> None:
    fake = FakeMusicBrainzFactory.knowing_let_down(image=image)

    answer = enricher_over(fake).enrich(EnrichTrackFactory.let_down(tmp_path))

    assert (answer.status, answer.cover, answer.values) == (EnrichStatus.OK, None, LET_DOWN_VALUES)
    assert list(tmp_path.iterdir()) == []


def test_a_cover_the_archive_lost_leaves_the_values_without_one(tmp_path: Path) -> None:
    fake = FakeMusicBrainzFactory.knowing_let_down()
    fake.answer(f"https://coverartarchive.org/release/{ORIGINAL}/front-500", Reply(404))

    answer = enricher_over(fake).enrich(EnrichTrackFactory.let_down(tmp_path))

    assert (answer.status, answer.cover, answer.values) == (EnrichStatus.OK, None, LET_DOWN_VALUES)


def test_a_song_of_a_second_disc_gives_its_disc_and_its_place_on_it(tmp_path: Path) -> None:
    release = MusicBrainzFactory.ok_computer(front=False)
    release["media"][0]["position"] = 2

    answer = enricher_over(knowing_the_release(release)).enrich(
        EnrichTrackFactory.let_down(tmp_path)
    )

    assert (answer.values["disc_number"], answer.values["track_number"]) == (2, 5)


def test_a_track_credited_to_two_artists_gives_the_credit_as_it_reads(tmp_path: Path) -> None:
    release = MusicBrainzFactory.ok_computer(front=False)
    release["media"][0]["tracks"][4]["artist-credit"] = [
        {"name": "GUMI", "joinphrase": "/"},
        {"name": "MAYU", "joinphrase": ""},
    ]

    answer = enricher_over(knowing_the_release(release)).enrich(
        EnrichTrackFactory.let_down(tmp_path)
    )

    assert answer.values["artist"] == "GUMI/MAYU"


def test_a_track_without_its_own_credit_takes_the_releases(tmp_path: Path) -> None:
    release = MusicBrainzFactory.ok_computer(front=False)
    del release["media"][0]["tracks"][4]["artist-credit"]

    answer = enricher_over(knowing_the_release(release)).enrich(
        EnrichTrackFactory.let_down(tmp_path)
    )

    assert answer.values["artist"] == "Radiohead"


def test_a_release_without_a_date_gives_no_year(tmp_path: Path) -> None:
    release = MusicBrainzFactory.ok_computer(front=False)
    del release["date"]

    answer = enricher_over(knowing_the_release(release)).enrich(
        EnrichTrackFactory.let_down(tmp_path)
    )

    assert "year" not in answer.values


@pytest.mark.parametrize("date", ["0000", "0000-00-00", "3000-01-01"])
def test_a_year_a_track_cannot_have_is_left_out(tmp_path: Path, date: str) -> None:
    release = MusicBrainzFactory.ok_computer(front=False, date=date)

    answer = enricher_over(knowing_the_release(release)).enrich(
        EnrichTrackFactory.let_down(tmp_path)
    )

    assert "year" not in answer.values


def test_a_track_or_disc_number_a_track_cannot_have_is_left_out(tmp_path: Path) -> None:
    release = MusicBrainzFactory.ok_computer(front=False)
    release["media"][0]["position"] = 0
    release["media"][0]["tracks"][4]["position"] = 1000

    answer = enricher_over(knowing_the_release(release)).enrich(
        EnrichTrackFactory.let_down(tmp_path)
    )

    assert not {"track_number", "disc_number"} & set(answer.values)
    assert answer.values["title"] == "Let Down"


def test_text_longer_than_a_value_may_be_is_cut(tmp_path: Path) -> None:
    release = MusicBrainzFactory.ok_computer(front=False)
    release["title"] = "A" * 600

    answer = enricher_over(knowing_the_release(release)).enrich(
        EnrichTrackFactory.let_down(tmp_path)
    )

    assert answer.values["album"] == "A" * 512


def test_a_release_that_lacks_the_recording_gives_only_what_the_release_says(
    tmp_path: Path,
) -> None:
    release = MusicBrainzFactory.ok_computer(front=False)
    release["media"][0]["tracks"][4]["recording"]["id"] = "another-recording"

    answer = enricher_over(knowing_the_release(release)).enrich(
        EnrichTrackFactory.let_down(tmp_path)
    )

    assert answer.values == {
        "album": "OK Computer",
        "album_artist": "Radiohead",
        "year": 1997,
        "genre": "rock",
    }


def test_a_track_far_from_every_recordings_length_finds_nothing(tmp_path: Path) -> None:
    fake = FakeMusicBrainzFactory.knowing_let_down()
    ask = EnrichTrackFactory.let_down(tmp_path, duration_ms=200_000)

    answer = enricher_over(fake).enrich(ask)

    assert (answer.status, answer.values, answer.cover) == (EnrichStatus.OK, {}, None)
    assert fake.urls() == [f"{API}/recording"] * 2, "searched with the album, then without"


def test_a_track_of_unknown_length_is_matched_by_its_words_alone(tmp_path: Path) -> None:
    fake = FakeMusicBrainzFactory.knowing_let_down()

    answer = enricher_over(fake).enrich(EnrichTrackFactory.let_down(tmp_path, duration_ms=None))

    assert answer.values == LET_DOWN_VALUES


def test_a_track_near_the_other_recordings_length_is_matched_to_that_recording(
    tmp_path: Path,
) -> None:
    search = MusicBrainzFactory.let_down_search()
    other = search["recordings"][1]
    official = next(each["id"] for each in other["releases"] if each["status"] == "Official")
    fake = (
        FakeMusicBrainz()
        .answer(f"{API}/recording", Reply.json(search))
        .answer(f"{API}/release/{official}", Reply(404))
    )

    enricher_over(fake).enrich(EnrichTrackFactory.let_down(tmp_path, duration_ms=176_000))

    assert fake.urls()[1] == f"{API}/release/{official}"


def test_every_candidate_scoring_under_ninety_finds_nothing(tmp_path: Path) -> None:
    fake = FakeMusicBrainz().answer(
        f"{API}/recording", Reply.json(MusicBrainzFactory.let_down_search(score=89))
    )

    answer = enricher_over(fake).enrich(EnrichTrackFactory.let_down(tmp_path))

    assert (answer.status, answer.values) == (EnrichStatus.OK, {})
    assert fake.urls() == [f"{API}/recording"] * 2, "searched with the album, then without"


def test_a_search_that_finds_no_recording_is_an_answer_with_no_values(tmp_path: Path) -> None:
    fake = FakeMusicBrainz().answer(f"{API}/recording", Reply.json({"recordings": []}))

    answer = enricher_over(fake).enrich(EnrichTrackFactory.let_down(tmp_path))

    assert (answer.status, answer.values, answer.video_text, answer.cover) == (
        EnrichStatus.OK,
        {},
        None,
        None,
    )


def test_a_release_that_is_gone_is_an_answer_with_no_values(tmp_path: Path) -> None:
    fake = (
        FakeMusicBrainz()
        .answer(f"{API}/recording", Reply.json(MusicBrainzFactory.let_down_search()))
        .answer(f"{API}/release/{ORIGINAL}", Reply(404))
    )

    answer = enricher_over(fake).enrich(EnrichTrackFactory.let_down(tmp_path))

    assert (answer.status, answer.values) == (EnrichStatus.OK, {})


def test_a_file_that_only_its_name_titles_is_not_searched_for(tmp_path: Path) -> None:
    fake = FakeMusicBrainzFactory.knowing_let_down()

    answer = enricher_over(fake).enrich(EnrichTrackFactory.untitled(tmp_path))

    assert (answer.values, fake.sent) == ({}, [])


def test_a_title_that_only_the_file_name_gives_is_not_a_search_term(tmp_path: Path) -> None:
    fake = FakeMusicBrainzFactory.knowing_let_down()
    ask = EnrichTrack(
        shown=(
            ShownDetail(field="title", value="BV1dm4y1s7ak", origin="file_name"),
            ShownDetail(field="artist", value="Radiohead", origin="files"),
        ),
        folder=str(tmp_path),
    )

    enricher_over(fake).enrich(ask)

    assert fake.sent == []


def test_a_forbidden_search_is_answered_as_refused(tmp_path: Path) -> None:
    fake = FakeMusicBrainz().answer(f"{API}/recording", Reply(403))

    answer = enricher_over(fake).enrich(EnrichTrackFactory.let_down(tmp_path))

    assert (answer.status, answer.message) == (
        EnrichStatus.REFUSED,
        "MusicBrainz refused the request (403).",
    )
    assert (answer.values, answer.cover) == ({}, None)


def test_a_forbidden_lookup_is_answered_as_refused(tmp_path: Path) -> None:
    fake = knowing_the_release({})
    fake.answer(f"{API}/release/{ORIGINAL}", Reply(403))

    answer = enricher_over(fake).enrich(EnrichTrackFactory.let_down(tmp_path))

    assert answer.status is EnrichStatus.REFUSED


def test_a_network_failure_is_raised_so_the_job_waits(tmp_path: Path) -> None:
    fake = FakeMusicBrainz().answer(f"{API}/recording", requests.ConnectionError("down"))

    with pytest.raises(NetworkError):
        enricher_over(fake).enrich(EnrichTrackFactory.let_down(tmp_path))


def test_a_rate_limit_that_never_lifts_is_raised_as_a_network_failure(tmp_path: Path) -> None:
    fake = FakeMusicBrainz().answer(f"{API}/recording", Reply(503, {"Retry-After": "1"}))

    with pytest.raises(NetworkError, match="too busy"):
        enricher_over(fake).enrich(EnrichTrackFactory.let_down(tmp_path))


def test_an_answer_in_a_shape_nobody_expected_is_a_fault_of_the_plugin(tmp_path: Path) -> None:
    fake = FakeMusicBrainz().answer(f"{API}/recording", Reply.json({"recordings": "none"}))

    with pytest.raises(ValueError, match="recordings"):
        enricher_over(fake).enrich(EnrichTrackFactory.let_down(tmp_path))


def test_an_album_file_is_matched_as_a_release_by_its_album_and_album_artist(
    tmp_path: Path,
) -> None:
    fake = FakeMusicBrainzFactory.knowing_shu_pu()

    answer = enricher_over(fake).enrich(EnrichTrackFactory.album_file(tmp_path))

    assert fake.urls()[:2] == [f"{API}/release", f"{API}/release/{SHU_PU}"]
    assert fake.parameter("query") == 'release:"生如夏花" AND artist:"朴树"'
    assert (answer.status, answer.values) == (
        EnrichStatus.OK,
        {"album": "生如夏花", "album_artist": "朴树", "year": 2003},
    )


def test_a_song_whose_recording_has_no_genres_takes_its_releases(tmp_path: Path) -> None:
    release = MusicBrainzFactory.ok_computer(front=False)
    for track in release["media"][0]["tracks"]:
        track["recording"]["genres"] = []

    answer = enricher_over(knowing_the_release(release)).enrich(
        EnrichTrackFactory.let_down(tmp_path)
    )

    assert answer.values["genre"] == "rock"


def test_a_song_with_no_genre_anywhere_gives_none(tmp_path: Path) -> None:
    release = MusicBrainzFactory.ok_computer(front=False)
    release["genres"] = []
    for track in release["media"][0]["tracks"]:
        track["recording"]["genres"] = []

    answer = enricher_over(knowing_the_release(release)).enrich(
        EnrichTrackFactory.let_down(tmp_path)
    )

    assert "genre" not in answer.values


def test_a_song_answers_what_listeners_rated_it_and_its_album(tmp_path: Path) -> None:
    fake = FakeMusicBrainzFactory.knowing_let_down()

    answer = enricher_over(fake).enrich(EnrichTrackFactory.let_down(tmp_path))

    assert answer.ratings == (
        CommunityRating(
            of=RatedAs.SONG,
            value=4.2,
            votes=24,
            link=f"https://musicbrainz.org/recording/{LET_DOWN}",
        ),
        CommunityRating(
            of=RatedAs.ALBUM,
            value=4.55,
            votes=89,
            link=f"https://musicbrainz.org/release-group/{OK_COMPUTER_GROUP}",
        ),
    )


def test_a_song_nobody_rated_answers_only_its_albums_rating(tmp_path: Path) -> None:
    release = MusicBrainzFactory.ok_computer(front=False)
    for track in release["media"][0]["tracks"]:
        track["recording"]["rating"] = {"value": None, "votes-count": 0}

    answer = enricher_over(knowing_the_release(release)).enrich(
        EnrichTrackFactory.let_down(tmp_path)
    )

    assert [rating.of for rating in answer.ratings] == [RatedAs.ALBUM]


def test_an_album_file_answers_only_its_albums_rating(tmp_path: Path) -> None:
    fake = FakeMusicBrainzFactory.knowing_shu_pu()
    fake.answer(
        f"{API}/release/{SHU_PU}", Reply.json(MusicBrainzFactory.shu_pu_release(rated=(3.5, 4)))
    )

    answer = enricher_over(fake).enrich(EnrichTrackFactory.album_file(tmp_path))

    assert answer.ratings == (
        CommunityRating(
            of=RatedAs.ALBUM,
            value=3.5,
            votes=4,
            link=f"https://musicbrainz.org/release-group/{SHU_PU_GROUP}",
        ),
    )


def test_an_album_whose_release_names_no_release_group_answers_no_rating(
    tmp_path: Path,
) -> None:
    fake = FakeMusicBrainzFactory.knowing_shu_pu()

    answer = enricher_over(fake).enrich(EnrichTrackFactory.album_file(tmp_path))

    assert answer.ratings == ()


def test_an_album_files_release_gives_its_most_counted_genres(tmp_path: Path) -> None:
    fake = FakeMusicBrainzFactory.knowing_shu_pu()
    release = MusicBrainzFactory.shu_pu_release(
        genres={"folk": 1, "rock": 4, "pop": 2, "ballad": 1}
    )
    fake.answer(f"{API}/release/{SHU_PU}", Reply.json(release))

    answer = enricher_over(fake).enrich(EnrichTrackFactory.album_file(tmp_path))

    assert answer.values["genre"] == "rock; pop; ballad"


def test_a_long_file_that_names_an_album_is_matched_as_a_release(tmp_path: Path) -> None:
    fake = FakeMusicBrainzFactory.knowing_shu_pu()

    answer = enricher_over(fake).enrich(EnrichTrackFactory.long_album_file(tmp_path))

    assert fake.urls()[:2] == [f"{API}/release", f"{API}/release/{SHU_PU}"]
    assert fake.parameter("query") == 'release:"生如夏花" AND artist:"朴树"'
    assert not {"title", "artist", "track_number", "disc_number"} & set(answer.values)
    assert answer.values["year"] == 2003


def test_a_file_of_twenty_minutes_is_still_searched_as_a_song(tmp_path: Path) -> None:
    fake = FakeMusicBrainz().answer(f"{API}/recording", Reply.json({"recordings": []}))

    enricher_over(fake).enrich(EnrichTrackFactory.long_album_file(tmp_path, duration_ms=1_200_000))

    assert set(fake.urls()) == {f"{API}/recording"}


def test_an_album_file_is_never_matched_as_one_recording(tmp_path: Path) -> None:
    fake = FakeMusicBrainzFactory.knowing_shu_pu()

    answer = enricher_over(fake).enrich(EnrichTrackFactory.album_file(tmp_path))

    assert f"{API}/recording" not in fake.urls()
    assert not {"title", "artist", "track_number", "disc_number"} & set(answer.values)


def test_an_album_files_release_brings_its_cover(tmp_path: Path) -> None:
    fake = FakeMusicBrainzFactory.knowing_shu_pu()

    answer = enricher_over(fake).enrich(EnrichTrackFactory.album_file(tmp_path))

    assert answer.cover is not None
    assert (tmp_path / answer.cover).read_bytes() == jpeg_image("生如夏花")


def test_an_album_with_no_artist_is_not_searched_for(tmp_path: Path) -> None:
    fake = FakeMusicBrainzFactory.knowing_shu_pu()
    ask = EnrichTrack(
        shown=(ShownDetail(field="album", value="生如夏花", origin="video"),),
        whole_album=True,
        folder=str(tmp_path),
    )

    answer = enricher_over(fake).enrich(ask)

    assert (answer.values, fake.sent) == ({}, [])


def test_an_album_files_artist_stands_in_for_a_missing_album_artist(tmp_path: Path) -> None:
    fake = FakeMusicBrainzFactory.knowing_shu_pu()
    ask = EnrichTrack(
        shown=(
            ShownDetail(field="album", value="生如夏花", origin="video"),
            ShownDetail(field="artist", value="朴树", origin="video"),
        ),
        whole_album=True,
        folder=str(tmp_path),
    )

    enricher_over(fake).enrich(ask)

    assert fake.parameter("query") == 'release:"生如夏花" AND artist:"朴树"'


def test_an_album_that_no_release_matches_finds_nothing(tmp_path: Path) -> None:
    fake = FakeMusicBrainz().answer(f"{API}/release", Reply.json({"releases": []}))

    answer = enricher_over(fake).enrich(EnrichTrackFactory.album_file(tmp_path))

    assert (answer.status, answer.values) == (EnrichStatus.OK, {})


def test_the_enricher_keeps_the_contract(tmp_path: Path) -> None:
    fake = FakeMusicBrainzFactory.knowing_let_down()

    answer = check_track_enricher(enricher_over(fake), EnrichTrackFactory.let_down(tmp_path))

    assert answer.values == LET_DOWN_VALUES
