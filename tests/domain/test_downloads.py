"""A Download is named by its Source: AAC from a downloader, any playable audio by hand."""

import pytest

from medleyplay.domain.catalog import SourceId
from medleyplay.domain.downloads import (
    MANUAL_EXTENSIONS,
    download_name,
    download_target,
    manual_download_name,
)
from medleyplay.domain.errors import InvalidInputError
from medleyplay.domain.playback import MEDIA_TYPES


def test_a_download_is_named_by_its_source_and_the_type_of_its_file() -> None:
    assert download_name(SourceId(7), "audio.M4A") == "7.m4a"


@pytest.mark.parametrize("file", ["audio.flac", "audio", "notes.txt", "audio.m4a.sh"])
def test_a_file_that_is_not_aac_audio_is_refused(file: str) -> None:
    with pytest.raises(InvalidInputError):
        download_name(SourceId(7), file)


def test_a_download_job_works_on_its_source() -> None:
    assert download_target(SourceId(7)) == "source:7"


def test_a_file_the_household_adds_is_named_by_its_source_and_its_lower_case_type() -> None:
    assert manual_download_name(SourceId(7), "Night Drive.FLAC") == "7.flac"


@pytest.mark.parametrize("extension", sorted(MANUAL_EXTENSIONS))
def test_every_type_the_player_serves_from_a_download_is_accepted_from_the_household(
    extension: str,
) -> None:
    assert manual_download_name(SourceId(7), f"song.{extension}") == f"7.{extension}"


@pytest.mark.parametrize("file", ["notes.txt", "song", "song.wma", "song.mp3.sh", ".wav", "song."])
def test_a_file_the_household_adds_with_another_type_or_none_is_refused(file: str) -> None:
    with pytest.raises(InvalidInputError):
        manual_download_name(SourceId(7), file)


def test_every_type_the_household_may_add_is_one_the_player_serves() -> None:
    assert set(MEDIA_TYPES) >= MANUAL_EXTENSIONS
