"""The scan program's covers: an image beside a file, and a cover embedded in it."""

import os
from pathlib import Path

import pytest

from medleyplay.domain.covers import MAX_COVER_BYTES, cover_id
from medleyplay.programs.scan_covers import CoverFile
from medleyplay.programs.scan_library import ScannedFile
from tests.support.audio import Song, folder_of, zip_of
from tests.support.images import (
    gif_image,
    image_beside,
    jpeg_image,
    jpeg_of_size,
    oversized_jpeg,
    png_image,
    webp_image,
)
from tests.support.scans import known_after, scan_files


def _copy_of(cover: CoverFile | None) -> bytes | None:
    """The bytes of the copy the scan kept in the Job's working folder, if it kept one."""
    return None if cover is None else Path(cover.path).read_bytes()


def _beside(file: ScannedFile) -> bytes | None:
    """The image the scan read beside the file, or `None` when it read none."""
    return None if file.cover_image is None else _copy_of(file.cover_image.cover)


@pytest.mark.parametrize(
    ("extension", "image"),
    [
        ("jpg", jpeg_image("Bremen")),
        ("jpeg", jpeg_image("Bremen")),
        ("png", png_image("Bremen")),
        ("webp", webp_image("Bremen")),
    ],
)
def test_an_image_beside_its_audio_is_read_and_is_not_a_file_of_its_own(
    tmp_path: Path, extension: str, image: bytes
) -> None:
    music = folder_of(tmp_path / "Music", {"Blue/a.wav": Song("A")})
    cover = image_beside(music / "Blue" / "a.wav", extension, image)

    found = scan_files(tmp_path, music)

    beside = found["Blue/a.wav"].cover_image
    assert list(found) == ["Blue/a.wav"]
    assert beside is not None
    assert beside.extension == extension
    assert (beside.size, beside.modified_ns) == (cover.stat().st_size, cover.stat().st_mtime_ns)
    assert beside.error == ""
    assert beside.cover is not None
    assert beside.cover.name == cover_id(image)
    assert _copy_of(beside.cover) == image


def test_an_image_named_in_capitals_is_read(tmp_path: Path) -> None:
    music = folder_of(tmp_path / "Music", {"a.wav": Song("A")})
    (music / "a.JPG").write_bytes(jpeg_image("Bremen"))

    found = scan_files(tmp_path, music)

    assert _beside(found["a.wav"]) == jpeg_image("Bremen")
    assert found["a.wav"].cover_image is not None
    assert found["a.wav"].cover_image.extension == "jpg"


def test_the_first_image_found_in_the_order_jpg_jpeg_png_webp_is_the_cover(tmp_path: Path) -> None:
    music = folder_of(
        tmp_path / "Music",
        {"jpg-png.wav": Song("A"), "png-webp.wav": Song("B"), "jpeg-webp.wav": Song("C")},
    )
    image_beside(music / "jpg-png.wav", "png", png_image())
    image_beside(music / "jpg-png.wav", "jpg", jpeg_image())
    image_beside(music / "png-webp.wav", "webp", webp_image())
    image_beside(music / "png-webp.wav", "png", png_image())
    image_beside(music / "jpeg-webp.wav", "webp", webp_image())
    image_beside(music / "jpeg-webp.wav", "jpeg", jpeg_image())

    found = scan_files(tmp_path, music)

    assert {path: _beside(file) for path, file in found.items()} == {
        "jpg-png.wav": jpeg_image(),
        "png-webp.wav": png_image(),
        "jpeg-webp.wav": jpeg_image(),
    }


def test_images_with_no_audio_beside_them_are_ignored_and_are_never_files(tmp_path: Path) -> None:
    music = folder_of(tmp_path / "Music", {"a.wav": Song("A"), "Blue/b.wav": Song("B")})
    (music / "orphan.jpg").write_bytes(jpeg_image())
    (music / "Blue" / "a.png").write_bytes(png_image())
    (music / "cover.jpg").write_bytes(jpeg_image())
    (music / "a.gif").write_bytes(gif_image())

    found = scan_files(tmp_path, music)

    assert list(found) == ["Blue/b.wav", "a.wav"]
    assert [file.cover_image for file in found.values()] == [None, None]


def test_a_changed_image_is_read_again_while_the_unchanged_audio_is_not(tmp_path: Path) -> None:
    music = folder_of(tmp_path / "Music", {"a.wav": Song("A")})
    image_beside(music / "a.wav", "jpg", jpeg_image("Bremen"))
    known = known_after(scan_files(tmp_path, music))

    changed = image_beside(music / "a.wav", "jpg", jpeg_image("Bremen, remastered"))
    os.utime(changed, ns=(1, 1))
    found = scan_files(tmp_path, music, known=known)

    assert found["a.wav"].changed is False
    assert found["a.wav"].tags is None
    assert _beside(found["a.wav"]) == jpeg_image("Bremen, remastered")


def test_an_unchanged_image_is_listed_with_its_stamp_but_not_read(tmp_path: Path) -> None:
    music = folder_of(tmp_path / "Music", {"a.wav": Song("A")})
    cover = image_beside(music / "a.wav", "jpg", jpeg_image())
    known = known_after(scan_files(tmp_path, music))

    beside = scan_files(tmp_path, music, known=known)["a.wav"].cover_image

    assert beside is not None
    assert (beside.size, beside.modified_ns) == (cover.stat().st_size, cover.stat().st_mtime_ns)
    assert (beside.cover, beside.error) == (None, "")


def test_a_full_scan_reads_an_unchanged_image(tmp_path: Path) -> None:
    music = folder_of(tmp_path / "Music", {"a.wav": Song("A")})
    image_beside(music / "a.wav", "jpg", jpeg_image("Bremen"))
    known = known_after(scan_files(tmp_path, music))

    found = scan_files(tmp_path, music, known=known, full=True)

    assert _beside(found["a.wav"]) == jpeg_image("Bremen")


def test_an_image_new_beside_a_known_audio_file_is_read(tmp_path: Path) -> None:
    music = folder_of(tmp_path / "Music", {"a.wav": Song("A")})
    known = known_after(scan_files(tmp_path, music))

    image_beside(music / "a.wav", "png", png_image("Bremen"))
    found = scan_files(tmp_path, music, known=known)

    assert found["a.wav"].changed is False
    assert _beside(found["a.wav"]) == png_image("Bremen")


def test_an_image_of_another_kind_with_the_stamp_of_the_one_known_is_read(tmp_path: Path) -> None:
    music = folder_of(tmp_path / "Music", {"a.wav": Song("A")})
    jpg = image_beside(music / "a.wav", "jpg", jpeg_image("Bremen"))
    known = known_after(scan_files(tmp_path, music))

    modified_ns = jpg.stat().st_mtime_ns
    jpg.unlink()
    png = image_beside(music / "a.wav", "png", png_image("ab"))
    os.utime(png, ns=(modified_ns, modified_ns))
    found = scan_files(tmp_path, music, known=known)

    assert len(jpeg_image("Bremen")) == len(png_image("ab"))
    assert _beside(found["a.wav"]) == png_image("ab")


def test_a_removed_image_is_no_longer_reported(tmp_path: Path) -> None:
    music = folder_of(tmp_path / "Music", {"a.wav": Song("A")})
    cover = image_beside(music / "a.wav", "jpg", jpeg_image())
    known = known_after(scan_files(tmp_path, music))

    cover.unlink()
    found = scan_files(tmp_path, music, known=known)

    assert found["a.wav"].cover_image is None


def test_songs_with_the_same_image_beside_them_share_one_copy(tmp_path: Path) -> None:
    music = folder_of(tmp_path / "Music", {"a.wav": Song("A"), "b.wav": Song("B")})
    image_beside(music / "a.wav", "jpg", jpeg_image("Bremen"))
    image_beside(music / "b.wav", "jpg", jpeg_image("Bremen"))

    found = scan_files(tmp_path, music)

    copies = {path: file.cover_image.cover for path, file in found.items() if file.cover_image}
    assert copies["a.wav"] == copies["b.wav"]
    assert len(list((tmp_path / "work" / "covers").iterdir())) == 1


@pytest.mark.parametrize(
    ("image", "error"),
    [
        pytest.param(gif_image(), "isn't a JPEG, PNG, or WebP image", id="a GIF named .jpg"),
        pytest.param(b"", "isn't a JPEG, PNG, or WebP image", id="a file of no bytes"),
        pytest.param(oversized_jpeg(), "too large", id="a file one byte over the limit"),
    ],
)
def test_an_image_that_is_no_cover_is_a_noted_error_and_the_scan_goes_on(
    tmp_path: Path, image: bytes, error: str
) -> None:
    music = folder_of(tmp_path / "Music", {"a.wav": Song("A"), "b.wav": Song("B")})
    image_beside(music / "a.wav", "jpg", image)

    found = scan_files(tmp_path, music)

    beside = found["a.wav"].cover_image
    assert beside is not None
    assert beside.cover is None
    assert error in beside.error
    assert found["a.wav"].tags is not None
    assert found["b.wav"].tags is not None


def test_an_image_at_the_limit_is_read(tmp_path: Path) -> None:
    music = folder_of(tmp_path / "Music", {"a.wav": Song("A")})
    image_beside(music / "a.wav", "jpg", jpeg_of_size(MAX_COVER_BYTES))

    beside = scan_files(tmp_path, music)["a.wav"].cover_image

    assert beside is not None
    assert beside.error == ""
    assert beside.cover is not None


def test_an_image_in_a_zip_archive_is_read_stored_or_compressed(tmp_path: Path) -> None:
    archive = zip_of(
        tmp_path / "Old.zip",
        {
            "x/stored.wav": Song("Stored"),
            "x/stored.jpg": jpeg_image("stored"),
            "x/deflated.wav": Song("Deflated"),
            "x/deflated.png": png_image("deflated"),
        },
        compressed=frozenset({"x/deflated.png"}),
    )

    found = scan_files(tmp_path, archive, "zip")

    assert {path: _beside(file) for path, file in found.items()} == {
        "x/deflated.wav": png_image("deflated"),
        "x/stored.wav": jpeg_image("stored"),
    }


def test_an_image_that_cant_be_opened_is_read_again_next_scan(tmp_path: Path) -> None:
    music = folder_of(tmp_path / "Music", {"a.wav": Song("A")})
    cover = image_beside(music / "a.wav", "jpg", jpeg_image())
    cover.chmod(0)

    beside = scan_files(tmp_path, music)["a.wav"].cover_image

    cover.chmod(0o644)
    assert beside is not None
    assert (beside.retry, "can't be read" in beside.error) == (True, True)


def test_a_cover_embedded_in_a_file_is_kept_as_a_copy_and_not_in_its_tags(tmp_path: Path) -> None:
    music = folder_of(tmp_path / "Music", {"a.wav": Song("A", cover=png_image("Bremen"))})

    file = scan_files(tmp_path, music)["a.wav"]

    assert file.embedded_cover is not None
    assert file.embedded_cover.name == cover_id(png_image("Bremen"))
    assert _copy_of(file.embedded_cover) == png_image("Bremen")
    assert file.tags is not None
    assert file.tags.cover is None
    assert file.cover_image is None


def test_a_file_with_no_embedded_cover_has_none(tmp_path: Path) -> None:
    music = folder_of(tmp_path / "Music", {"a.wav": Song("A")})

    assert scan_files(tmp_path, music)["a.wav"].embedded_cover is None


def test_songs_with_the_same_embedded_cover_share_one_copy(tmp_path: Path) -> None:
    cover = jpeg_image("Bremen")
    music = folder_of(
        tmp_path / "Music", {"a.wav": Song("A", cover=cover), "b.wav": Song("B", cover=cover)}
    )

    found = scan_files(tmp_path, music)

    assert found["a.wav"].embedded_cover == found["b.wav"].embedded_cover
    assert len(list((tmp_path / "work" / "covers").iterdir())) == 1


def test_an_embedded_cover_of_the_limit_comes_through_the_plugin_host(tmp_path: Path) -> None:
    image = jpeg_of_size(MAX_COVER_BYTES)
    music = folder_of(tmp_path / "Music", {"a.wav": Song("A", cover=image)})

    file = scan_files(tmp_path, music)["a.wav"]

    assert _copy_of(file.embedded_cover) == image


def test_an_embedded_cover_in_a_zip_archive_is_kept(tmp_path: Path) -> None:
    archive = zip_of(tmp_path / "Old.zip", {"x/a.wav": Song("A", cover=jpeg_image("Bremen"))})

    found = scan_files(tmp_path, archive, "zip")

    assert _copy_of(found["x/a.wav"].embedded_cover) == jpeg_image("Bremen")
