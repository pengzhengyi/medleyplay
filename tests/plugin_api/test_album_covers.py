"""A cover finder's answer: each cover names its release by a MusicBrainz id, and a bare file."""

import pytest
from pydantic import ValidationError

from medleyplay.plugin_api import MAX_COVERS, FoundCover, FoundCovers

OK_COMPUTER = "b1392450-e666-3926-a536-22c65f834433"


@pytest.mark.parametrize(
    "release_id",
    ["../../etc/passwd", "b1392450", f"{OK_COMPUTER}/front", ""],
    ids=["a path", "too short", "more than an id", "empty"],
)
def test_a_release_id_that_is_not_a_musicbrainz_id_is_refused(release_id: str) -> None:
    with pytest.raises(ValidationError):
        FoundCover(release_id=release_id, title="OK Computer", file="cover.jpg")


@pytest.mark.parametrize(
    "file", ["../cover.jpg", "covers/cover.jpg", "covers\\cover.jpg", ""], ids=str
)
def test_a_file_that_is_not_a_bare_name_is_refused(file: str) -> None:
    with pytest.raises(ValidationError):
        FoundCover(release_id=OK_COMPUTER, title="OK Computer", file=file)


def test_a_cover_names_its_release_and_the_file_written() -> None:
    cover = FoundCover(
        release_id=OK_COMPUTER,
        title="OK Computer",
        date="1997-05-21",
        country="GB",
        format="CD",
        tracks=12,
        file="b1392450.jpg",
    )

    assert (cover.release_id, cover.file) == (OK_COMPUTER, "b1392450.jpg")


def test_no_more_covers_than_the_most_are_taken() -> None:
    cover = FoundCover(release_id=OK_COMPUTER, title="OK Computer", file="cover.jpg")

    with pytest.raises(ValidationError):
        FoundCovers(covers=(cover,) * (MAX_COVERS + 1))
