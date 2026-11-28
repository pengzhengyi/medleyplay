"""Staged bytes cannot overwrite an existing publication or escape the folder."""

import uuid
from pathlib import Path

import pytest

from medleyplay.application import download_files
from medleyplay.application.download_files import download_basename, publish_staged
from medleyplay.domain.errors import InvalidInputError


def test_a_candidate_name_collision_preserves_the_existing_file(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    generation = uuid.UUID(int=42)
    monkeypatch.setattr(download_files, "uuid4", lambda: generation)
    folder = tmp_path / "downloads"
    folder.mkdir()
    existing = folder / f"7-{generation.hex}.m4a"
    existing.write_bytes(b"saved audio")
    staged = tmp_path / "new.m4a"
    staged.write_bytes(b"fresh audio")

    with pytest.raises(FileExistsError):
        publish_staged(folder, staged, "7.m4a", 11, 100)

    assert existing.read_bytes() == b"saved audio"


def test_a_case_alias_of_the_download_directory_keeps_the_same_file_identity(
    tmp_path: Path,
) -> None:
    folder = tmp_path / "downloads"
    folder.mkdir()
    alias = tmp_path / "DOWNLOADS"
    if not alias.is_dir():
        pytest.skip("This file system distinguishes directory-name case.")

    assert download_basename(folder, str(alias / "7.m4a")) == "7.m4a"


@pytest.mark.parametrize("size", [0, 5, 11])
def test_a_staged_file_with_a_mismatched_or_excessive_size_is_not_published(
    tmp_path: Path,
    size: int,
) -> None:
    folder = tmp_path / "downloads"
    staged = tmp_path / "take.m4a"
    staged.write_bytes(b"x" * size)

    with pytest.raises(InvalidInputError, match="expected size"):
        publish_staged(folder, staged, "7.m4a", 10, 10)

    assert list(folder.iterdir()) == []
