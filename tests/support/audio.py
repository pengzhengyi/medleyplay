"""Audio files the tests make: small WAV files with tags, in folders and zip archives."""

import io
import struct
import wave
import zipfile
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

RATE = 8000


@dataclass(frozen=True)
class Song:
    """What a test audio file says about its music, how long it is, and its front cover.

    A `cover` of no bytes means the file has none.
    """

    title: str = "Intro"
    artist: str = "The Band"
    album: str = "Blue"
    seconds: float = 1.0
    cover: bytes = b""


def wav_bytes(song: Song) -> bytes:
    """Return a silent mono WAV file whose RIFF `INFO` chunk carries the song's tags.

    A song with a cover gets an `id3 ` chunk after them, holding the cover:

        RIFF WAVE
          fmt, data    one second of silence
          LIST INFO    INAM, IART, IPRD
          id3          ID3v2.3 tag with one APIC frame, the front cover
    """
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(RATE)
        audio.writeframes(b"\0\0" * int(RATE * song.seconds))
    data = bytearray(buffer.getvalue())
    info = b"INFO"
    for key, value in (("INAM", song.title), ("IART", song.artist), ("IPRD", song.album)):
        text = value.encode() + b"\0"
        info += key.encode() + struct.pack("<I", len(text)) + text + (b"\0" * (len(text) % 2))
    data += b"LIST" + struct.pack("<I", len(info)) + info
    if song.cover:
        tag = id3_tag(song)
        data += b"id3 " + struct.pack("<I", len(tag)) + tag + (b"\0" * (len(tag) % 2))
    struct.pack_into("<I", data, 4, len(data) - 8)
    return bytes(data)


def mp3_bytes(song: Song) -> bytes:
    """Return an MP3 file: an ID3v2.3 tag with the song's tags and cover, then silent frames."""
    frame = b"\xff\xfb\x90\x00" + bytes(413)
    return id3_tag(song) + frame * max(1, round(song.seconds * 38))


def id3_tag(song: Song) -> bytes:
    """Return an ID3v2.3 tag holding the song's title, artist, album, and cover.

    The cover is an `APIC` frame of picture type 3, the front cover, with the media
    type `image/jpeg`, whatever the bytes are.
    """
    frames = b"".join(
        _id3_frame(name, b"\x03" + value.encode())
        for name, value in (("TIT2", song.title), ("TPE1", song.artist), ("TALB", song.album))
    )
    if song.cover:
        frames += _id3_frame("APIC", b"\x00image/jpeg\x00\x03\x00" + song.cover)
    size = len(frames)
    syncsafe = bytes((size >> shift) & 0x7F for shift in (21, 14, 7, 0))
    return b"ID3\x03\x00\x00" + syncsafe + frames


def _id3_frame(name: str, content: bytes) -> bytes:
    return name.encode() + struct.pack(">I", len(content)) + b"\0\0" + content


def folder_of(root: Path, songs: Mapping[str, Song]) -> Path:
    """Write each song at its path under `root`, such as `Blue/01 Intro.wav`; return `root`.

    A path with another extension gets the song's WAV bytes all the same.
    """
    for path, song in songs.items():
        file = root / path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(wav_bytes(song))
    return root


def zip_of(
    archive: Path, songs: Mapping[str, Song | bytes], *, compressed: frozenset[str] = frozenset()
) -> Path:
    """Write a zip archive holding each song at its path; return the archive.

    A song is written as a WAV file, and bytes as they are. Members in `compressed`
    are deflated; the rest are stored uncompressed.
    """
    archive.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive, "w") as zip_file:
        for path, song in songs.items():
            method = zipfile.ZIP_DEFLATED if path in compressed else zipfile.ZIP_STORED
            content = song if isinstance(song, bytes) else wav_bytes(song)
            zip_file.writestr(zipfile.ZipInfo(path), content, compress_type=method)
    return archive


def mark_encrypted(archive: Path, member: str) -> None:
    """Set the encrypted flag of `member` in the archive's central directory.

    `zipfile` can't write encrypted members, so this makes one that only claims to be.
    """
    data = bytearray(archive.read_bytes())
    signature = b"PK\x01\x02"
    position = data.find(signature)
    while position != -1:
        name_length = struct.unpack_from("<H", data, position + 28)[0]
        name = bytes(data[position + 46 : position + 46 + name_length]).decode()
        if name == member:
            flags = struct.unpack_from("<H", data, position + 8)[0]
            struct.pack_into("<H", data, position + 8, flags | 0x1)
        position = data.find(signature, position + 1)
    archive.write_bytes(bytes(data))
