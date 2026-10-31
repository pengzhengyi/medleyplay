"""Covers: an image known by its first bytes and named by its content."""

import hashlib

import pytest

from medleyplay.domain.covers import CoverType, cover_id, cover_type, is_cover_id

JPEG = b"\xff\xd8\xff\xe0" + b"\0" * 16
PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 16
WEBP = b"RIFF\x10\0\0\0WEBP" + b"VP8 " + b"\0" * 8


@pytest.mark.parametrize(
    ("data", "kind"),
    [(JPEG, CoverType.JPEG), (PNG, CoverType.PNG), (WEBP, CoverType.WEBP)],
    ids=["JPEG", "PNG", "WebP"],
)
def test_a_cover_is_known_by_its_first_bytes(data: bytes, kind: CoverType) -> None:
    assert cover_type(data) is kind


@pytest.mark.parametrize(
    "data",
    [
        b"GIF89a" + b"\0" * 16,
        b"<svg xmlns='http://www.w3.org/2000/svg'/>",
        b"RIFF\0\0\0\0WAVE",
        b"",
    ],
    ids=["GIF", "SVG", "a WAV file named cover.jpg", "nothing"],
)
def test_anything_else_is_no_cover(data: bytes) -> None:
    assert cover_type(data) is None


def test_a_cover_is_named_by_the_sha256_of_its_bytes() -> None:
    assert cover_id(PNG) == hashlib.sha256(PNG).hexdigest()
    assert is_cover_id(cover_id(PNG))


@pytest.mark.parametrize(
    "name", ["", "abc", "A" * 64, "g" * 64, "0" * 63, "../" + "0" * 61, "0" * 64 + "\n"]
)
def test_a_name_other_than_a_sha256_names_no_cover(name: str) -> None:
    assert not is_cover_id(name)
