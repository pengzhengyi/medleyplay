"""Image bytes the tests use as covers: each opens as its type does, then holds a label."""

from pathlib import Path

from medleyplay.domain.covers import MAX_COVER_BYTES, cover_id
from medleyplay.programs.scan_covers import CoverFile


def jpeg_image(label: str = "cover") -> bytes:
    """Return a JPEG image's bytes: its first bytes, then `label`.

    `jpeg_image("Bremen")` is `ff d8 ff e0` followed by `Bremen`. Two labels give two covers.
    """
    return b"\xff\xd8\xff\xe0" + label.encode()


def png_image(label: str = "cover") -> bytes:
    """Return a PNG image's bytes: its eight signature bytes, then `label`."""
    return b"\x89PNG\r\n\x1a\n" + label.encode()


def webp_image(label: str = "cover") -> bytes:
    """Return a WebP image's bytes: `RIFF`, a size, `WEBP`, then `label`."""
    return b"RIFF\x10\0\0\0WEBP" + label.encode()


def gif_image(label: str = "cover") -> bytes:
    """Return a GIF image's bytes, which are no cover: `GIF89a`, then `label`."""
    return b"GIF89a" + label.encode()


def jpeg_of_size(size: int) -> bytes:
    """Return a JPEG image of exactly `size` bytes."""
    head = jpeg_image("")
    return head + b"\0" * (size - len(head))


def oversized_jpeg() -> bytes:
    """Return a JPEG image one byte over the limit of a cover."""
    return jpeg_of_size(MAX_COVER_BYTES + 1)


def image_beside(audio: Path, extension: str, image: bytes) -> Path:
    """Write `image` as the file beside `audio` that has this extension, and return it.

    `Music/BV1dm4y1s7ak.m4a` with `"jpg"` gets `Music/BV1dm4y1s7ak.jpg`, as yt-dlp's
    `--write-thumbnail` names it.
    """
    cover = audio.with_name(f"{audio.stem}.{extension}")
    cover.write_bytes(image)
    return cover


def copy_of(folder: Path, image: bytes) -> CoverFile:
    """Write `image` in `folder` as the scan's Job does, and return the copy.

    The copy is named by the SHA-256 of its bytes: `<folder>/9f2c...`.
    """
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / cover_id(image)
    path.write_bytes(image)
    return CoverFile(name=cover_id(image), path=str(path))
