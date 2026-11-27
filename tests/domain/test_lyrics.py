"""Reading lyrics: timed LRC, line by line or word by word, or plain text."""

import pytest

from medleyplay.domain.errors import InvalidInputError
from medleyplay.domain.lyrics import MAX_LYRICS, Line, Word, parse_lyrics


def test_lrc_is_read_as_lines_each_at_its_time() -> None:
    text = """\
[ti:Melt]
[ar:ryo]
[00:12.34]朝目が覚めて
[00:15.5]真っ先に思い浮かぶ
[01:02.003]君のこと
"""

    lyrics = parse_lyrics(text)

    assert lyrics.synced
    assert lyrics.lines == (
        Line(12_340, "朝目が覚めて"),
        Line(15_500, "真っ先に思い浮かぶ"),
        Line(62_003, "君のこと"),
    )


def test_a_line_with_several_times_is_sung_at_each() -> None:
    text = """\
[00:30.00][01:30.00]Chorus
[01:00.00]Verse
"""

    lyrics = parse_lyrics(text)

    assert [(line.at_ms, line.text) for line in lyrics.lines] == [
        (30_000, "Chorus"),
        (60_000, "Verse"),
        (90_000, "Chorus"),
    ]


def test_an_offset_moves_every_line() -> None:
    text = """\
[offset:+500]
[00:10.00]Early
"""

    assert parse_lyrics(text).lines == (Line(9_500, "Early"),)


def test_a_second_line_at_the_same_time_is_the_firsts_translation() -> None:
    text = """\
[00:12.34]朝目が覚めて
[00:12.34]Waking up in the morning
[00:15.50]真っ先に思い浮かぶ
"""

    lyrics = parse_lyrics(text)

    assert lyrics.lines == (
        Line(12_340, "朝目が覚めて", translation="Waking up in the morning"),
        Line(15_500, "真っ先に思い浮かぶ"),
    )


@pytest.mark.parametrize(
    ("spoken", "words"), [("Hello", ()), ("<00:04>Hello", (Word(4_000, "Hello"),))]
)
def test_a_translation_keeps_text_before_word_timestamps_and_the_spoken_words(
    spoken: str, words: tuple[Word, ...]
) -> None:
    text = f"""\
[00:04]{spoken}
[00:04]Bonjour <00:05>monde
"""

    assert parse_lyrics(text).lines == (
        Line(4_000, "Hello", translation="Bonjour monde", words=words),
    )


def test_word_times_are_kept_with_each_word() -> None:
    text = "[00:01.00]<00:01.00>Hello <00:01.50>world\n"

    lyrics = parse_lyrics(text)

    assert lyrics.lines == (
        Line(1_000, "Hello world", words=(Word(1_000, "Hello "), Word(1_500, "world"))),
    )


def test_an_empty_timed_line_is_a_pause_in_the_singing() -> None:
    text = """\
[00:10.00]Sung
[00:20.00]
[00:30.00]Sung again
"""

    assert [line.text for line in parse_lyrics(text).lines] == ["Sung", "", "Sung again"]


def test_word_timestamps_without_words_are_not_readable_lines_or_translations() -> None:
    text = """\
[00:10.00]<00:10.00>
[00:10.00]<00:10.50>
[00:20.00]<00:20.00>
"""

    assert parse_lyrics(text).lines == (Line(10_000, ""), Line(20_000, ""))


def test_text_with_no_times_is_plain_lyrics() -> None:
    text = """\
朝目が覚めて
真っ先に思い浮かぶ
"""

    lyrics = parse_lyrics(text)

    assert not lyrics.synced
    assert lyrics.lines == ()
    assert lyrics.plain == "朝目が覚めて\n真っ先に思い浮かぶ"


@pytest.mark.parametrize(
    "text",
    ["x" * (MAX_LYRICS + 1), "\n".join(f"[00:{n % 60:02d}.00]{n}" for n in range(2_001))],
    ids=["too long", "too many lines"],
)
def test_lyrics_longer_than_a_song_could_have_are_refused(text: str) -> None:
    with pytest.raises(InvalidInputError):
        parse_lyrics(text)
