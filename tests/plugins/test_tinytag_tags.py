"""The tinytag tag reader: tags from whole files and zip members, and what it can't read."""

import base64
import shutil
import subprocess
from collections.abc import Callable
from pathlib import Path

import pytest

from medleyplay.domain import covers
from medleyplay.plugin_api import FileRequest, LibraryRoot, ReadTags, Tags
from medleyplay.plugin_api.covers import MAX_COVER_BYTES, is_cover_image
from medleyplay.plugin_api.testing import check_tag_reader
from medleyplay.plugins.fsspec_library.backends import ZipBackend
from medleyplay.plugins.tinytag_tags import TinytagReader, register
from tests.support.audio import Song, folder_of, mp3_bytes, wav_bytes, zip_of
from tests.support.images import (
    gif_image,
    jpeg_image,
    jpeg_of_size,
    oversized_jpeg,
    png_image,
    webp_image,
)
from tests.support.mp4 import Mp4, mp4_bytes


def test_the_reader_keeps_the_contract_and_reads_the_tags(tmp_path: Path) -> None:
    folder_of(tmp_path, {"intro.wav": Song("Intro", "The Band", "Blue", seconds=2)})

    tags = check_tag_reader(TinytagReader(), ReadTags(local_path=str(tmp_path / "intro.wav")))

    assert tags == Tags(title="Intro", artist="The Band", album="Blue", duration_ms=2000)


def test_a_stored_zip_member_is_read_in_place(tmp_path: Path) -> None:
    archive = zip_of(tmp_path / "a.zip", {"x/one.wav": Song("One")})
    location = ZipBackend().locate(
        FileRequest(root=LibraryRoot(kind="zip", path=str(archive)), path="x/one.wav")
    )

    tags = TinytagReader().read_tags(
        ReadTags(local_path=str(archive), offset=location.offset, length=location.length)
    )

    assert tags.title == "One"


def test_a_fragmented_mp4_is_as_long_as_its_fragments(tmp_path: Path) -> None:
    song = tmp_path / "song.m4a"
    song.write_bytes(mp4_bytes(Mp4(fragment_seconds=3.5)))

    tags = TinytagReader(mp4=True).read_tags(ReadTags(local_path=str(song)))

    assert tags.duration_ms == 3500


def test_a_fragmented_mp4_zip_member_is_as_long_as_its_fragments(tmp_path: Path) -> None:
    archive = zip_of(
        tmp_path / "a.zip",
        {"x/one.wav": Song("One"), "x/two.m4a": mp4_bytes(Mp4(segment_seconds=(1.5, 2.5)))},
    )
    location = ZipBackend().locate(
        FileRequest(root=LibraryRoot(kind="zip", path=str(archive)), path="x/two.m4a")
    )

    tags = TinytagReader(mp4=True).read_tags(
        ReadTags(local_path=str(archive), offset=location.offset, length=location.length)
    )

    assert tags.duration_ms == 4000


def test_an_mp4_keeps_the_length_tinytag_reads_from_its_header(tmp_path: Path) -> None:
    song = tmp_path / "song.m4a"
    song.write_bytes(mp4_bytes(Mp4(header_seconds=2, fragment_seconds=5)))

    tags = TinytagReader(mp4=True).read_tags(ReadTags(local_path=str(song)))

    assert tags.duration_ms == 2000


def test_a_fragmented_mp4_without_a_length_in_its_boxes_keeps_the_zero_tinytag_reads(
    tmp_path: Path,
) -> None:
    song = tmp_path / "song.m4a"
    song.write_bytes(mp4_bytes(Mp4()))

    tags = TinytagReader(mp4=True).read_tags(ReadTags(local_path=str(song)))

    assert tags.duration_ms == 0


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="needs ffmpeg to make the file")
def test_a_fragmented_m4a_made_by_ffmpeg_is_as_long_as_its_audio(tmp_path: Path) -> None:
    song = tmp_path / "sine.m4a"
    ffmpeg = [str(shutil.which("ffmpeg")), "-v", "error", "-f", "lavfi", "-i", "sine=d=3"]
    flags = "frag_keyframe+empty_moov+default_base_moof+global_sidx"
    subprocess.run([*ffmpeg, "-c:a", "aac", "-movflags", flags, str(song)], check=True)  # noqa: S603 # a fixed ffmpeg command

    tags = TinytagReader(mp4=True).read_tags(ReadTags(local_path=str(song)))

    assert tags.duration_ms == pytest.approx(3000, abs=50)


def test_a_file_tinytag_cant_parse_has_no_tags(tmp_path: Path) -> None:
    broken = tmp_path / "broken.mp3"
    broken.write_bytes(b"not audio at all")

    assert TinytagReader().read_tags(ReadTags(local_path=str(broken))) == Tags()


def test_a_protected_reader_marks_what_it_reads_protected(tmp_path: Path) -> None:
    broken = tmp_path / "song.m4p"
    broken.write_bytes(b"locked")

    assert TinytagReader(protected=True).read_tags(ReadTags(local_path=str(broken))).protected


class _Recorder:
    """Records what a plugin registers, in place of the registry."""

    def __init__(self) -> None:
        self.readers: dict[str, TinytagReader] = {}

    def add(self, point: object, key: str, provider: TinytagReader) -> None:
        self.readers[key] = provider


def test_the_plugin_reads_audio_extensions_and_marks_only_m4p_protected(tmp_path: Path) -> None:
    registry = _Recorder()
    unreadable = tmp_path / "unreadable"
    unreadable.write_bytes(b"x")

    register(registry)  # type: ignore[arg-type] # a recorder in place of the registry
    protected = [
        key
        for key, reader in registry.readers.items()
        if reader.read_tags(ReadTags(local_path=str(unreadable))).protected
    ]

    assert {"mp3", "flac", "m4a", "wav", "m4p"} <= set(registry.readers)
    assert "m4v" not in registry.readers
    assert protected == ["m4p"]


def test_the_plugin_reads_fragment_lengths_only_for_mp4_extensions(tmp_path: Path) -> None:
    registry = _Recorder()
    fragmented = tmp_path / "fragmented"
    fragmented.write_bytes(mp4_bytes(Mp4(fragment_seconds=3.5)))

    register(registry)  # type: ignore[arg-type] # a recorder in place of the registry
    read_fragments = {
        key
        for key, reader in registry.readers.items()
        if reader.read_tags(ReadTags(local_path=str(fragmented))).duration_ms == 3500
    }

    assert read_fragments == {"m4a", "m4b", "mp4"}


def _wav(cover: bytes) -> bytes:
    return wav_bytes(Song(cover=cover))


def _mp3(cover: bytes) -> bytes:
    return mp3_bytes(Song(cover=cover))


def _m4a(cover: bytes) -> bytes:
    return mp4_bytes(Mp4(cover=cover))


EMBEDDING: list[tuple[str, Callable[[bytes], bytes]]] = [
    ("wav", _wav),
    ("mp3", _mp3),
    ("m4a", _m4a),
]
"""How to make an audio file that holds an image as its front cover, by extension."""


def _read_cover(tmp_path: Path, extension: str, content: bytes) -> bytes | None:
    """Write `content` as a file of this extension, read its tags, and return its cover."""
    audio = tmp_path / f"song.{extension}"
    audio.write_bytes(content)
    tags = TinytagReader(mp4=True).read_tags(ReadTags(local_path=str(audio)))
    return None if tags.cover is None else base64.b64decode(tags.cover, validate=True)


@pytest.mark.parametrize(("extension", "make"), EMBEDDING)
@pytest.mark.parametrize(
    "image", [jpeg_image(), png_image(), webp_image()], ids=["JPEG", "PNG", "WebP"]
)
def test_the_front_cover_embedded_in_a_file_is_read(
    tmp_path: Path, extension: str, make: Callable[[bytes], bytes], image: bytes
) -> None:
    assert _read_cover(tmp_path, extension, make(image)) == image


@pytest.mark.parametrize(("extension", "make"), EMBEDDING)
def test_a_file_of_no_cover_reads_none(
    tmp_path: Path, extension: str, make: Callable[[bytes], bytes]
) -> None:
    assert _read_cover(tmp_path, extension, make(b"")) is None


@pytest.mark.parametrize(("extension", "make"), EMBEDDING)
def test_an_embedded_gif_is_no_cover(
    tmp_path: Path, extension: str, make: Callable[[bytes], bytes]
) -> None:
    assert _read_cover(tmp_path, extension, make(gif_image())) is None


@pytest.mark.parametrize(("extension", "make"), EMBEDDING)
def test_an_embedded_cover_one_byte_over_the_limit_is_no_cover(
    tmp_path: Path, extension: str, make: Callable[[bytes], bytes]
) -> None:
    assert _read_cover(tmp_path, extension, make(oversized_jpeg())) is None


def test_an_embedded_cover_of_exactly_the_limit_is_read(tmp_path: Path) -> None:
    image = jpeg_of_size(MAX_COVER_BYTES)

    assert _read_cover(tmp_path, "wav", _wav(image)) == image


def test_a_cover_embedded_in_a_zip_member_is_read(tmp_path: Path) -> None:
    image = png_image("Bremen")
    archive = zip_of(tmp_path / "a.zip", {"x/one.wav": Song("One", cover=image)})
    location = ZipBackend().locate(
        FileRequest(root=LibraryRoot(kind="zip", path=str(archive)), path="x/one.wav")
    )

    tags = TinytagReader().read_tags(
        ReadTags(local_path=str(archive), offset=location.offset, length=location.length)
    )

    assert tags.cover is not None
    assert base64.b64decode(tags.cover) == image


def test_the_tags_of_a_file_with_a_cover_keep_the_contract(tmp_path: Path) -> None:
    folder_of(tmp_path, {"intro.wav": Song("Intro", cover=jpeg_image("Bremen"))})

    tags = check_tag_reader(TinytagReader(), ReadTags(local_path=str(tmp_path / "intro.wav")))

    assert tags.title == "Intro"
    assert tags.cover is not None


@pytest.mark.parametrize(
    "data",
    [
        jpeg_image(),
        png_image(),
        webp_image(),
        gif_image(),
        b"RIFF\0\0\0\0WAVE",
        b"<svg/>",
        b"",
    ],
    ids=["JPEG", "PNG", "WebP", "GIF", "a WAV file", "SVG", "nothing"],
)
def test_the_plugin_and_the_core_agree_on_what_a_cover_is(data: bytes) -> None:
    assert is_cover_image(data) == (covers.cover_type(data) is not None)


def test_the_plugin_and_the_core_agree_on_the_limit_of_a_cover() -> None:
    assert MAX_COVER_BYTES == covers.MAX_COVER_BYTES
