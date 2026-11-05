"""What a model says is checked against the limits the household's own input has."""

import json
from typing import Any

import pytest

from medleyplay.plugin_api import SuggestedSong
from medleyplay.plugins.ai_details.models import MAX_SONGS, BadAnswerError, parse_answer
from tests.support.ai import ChatAnswerFactory


def say(answer: dict[str, Any]) -> str:
    """The text a model says when it answers `answer`."""
    return json.dumps(answer)


def test_a_song_answer_gives_its_title_artist_album_and_year() -> None:
    answer = parse_answer(say(ChatAnswerFactory.night_drive()))

    assert answer.values() == {
        "title": "Night Drive",
        "artist": "Blue Room",
        "album": "Re:Start",
        "year": 2016,
    }
    assert answer.suggested_songs() == ()


def test_an_album_answer_gives_its_songs_with_their_starts_in_milliseconds() -> None:
    answer = parse_answer(say(ChatAnswerFactory.album()))

    assert answer.values() == {"artist": "Blue Room", "album": "Re:Start", "year": 2016}
    assert answer.suggested_songs() == (
        SuggestedSong(start_ms=0, title="Intro"),
        SuggestedSong(start_ms=192_000, title="Night Drive", artist="Blue Room"),
        SuggestedSong(start_ms=4_060_000, title="Outro"),
    )


def test_what_the_model_leaves_null_blank_or_out_gives_no_value() -> None:
    answer = parse_answer(say({"title": "  ", "artist": None, "year": None}))

    assert answer.values() == {}


def test_text_is_trimmed() -> None:
    assert parse_answer(say({"title": "  Night Drive \n"})).values() == {"title": "Night Drive"}


def test_a_key_the_model_adds_is_ignored() -> None:
    answer = parse_answer(say({"title": "Night Drive", "confidence": 0.9, "notes": "Maybe"}))

    assert answer.values() == {"title": "Night Drive"}


def test_a_json_object_in_a_code_fence_is_read() -> None:
    fenced = '```json\n{"title": "Night Drive"}\n```'

    assert parse_answer(fenced).values() == {"title": "Night Drive"}


def test_a_year_written_as_text_is_read() -> None:
    assert parse_answer(say({"year": "2016"})).values() == {"year": 2016}


@pytest.mark.parametrize(
    ("start", "milliseconds"),
    [
        ("00:00", 0),
        ("3:12", 192_000),
        ("03:12", 192_000),
        ("1:07:40", 4_060_000),
        ("01:07:40", 4_060_000),
        ("120:05", 7_205_000),
        (192, 192_000),
        (192.5, 192_500),
        ("192", 192_000),
    ],
)
def test_a_start_is_a_time_like_mm_ss_or_h_mm_ss_or_seconds(
    start: str | float, milliseconds: int
) -> None:
    songs = [{"start": start, "title": "First"}, {"start": "200:00", "title": "Last"}]

    found = parse_answer(say({"songs": songs})).suggested_songs()

    assert found[0].start_ms == milliseconds


# What breaks the limits


def _songs(count: int, *, step: int = 60) -> list[dict[str, Any]]:
    return [{"start": each * step, "title": f"Song {each}"} for each in range(count)]


@pytest.mark.parametrize(
    "answer",
    [
        {"title": "t" * 513},
        {"artist": "a" * 513},
        {"album": "a" * 513},
        {"year": 99},
        {"year": 3000},
        {"year": "soon"},
        {"title": 7},
        {"songs": "none"},
        {"songs": [{"start": "soon", "title": "Intro"}, {"start": 60, "title": "Next"}]},
        {"songs": [{"start": -5, "title": "Intro"}, {"start": 60, "title": "Next"}]},
        {"songs": [{"start": 0, "title": "  "}, {"start": 60, "title": "Next"}]},
        {"songs": [{"start": 0}, {"start": 60, "title": "Next"}]},
        {"songs": [{"start": 0, "title": "t" * 513}, {"start": 60, "title": "Next"}]},
        {"songs": [{"start": 0, "title": "A", "artist": "a" * 513}, {"start": 60, "title": "B"}]},
        {"songs": [{"start": 60, "title": "A"}, {"start": 0, "title": "B"}]},
        {"songs": [{"start": 0, "title": "A"}, {"start": 0, "title": "B"}]},
        {"songs": [{"start": 0, "title": "A"}, {"start": 0.5, "title": "B"}]},
        {"songs": [{"start": 0, "title": "A"}, {"start": 10_000_000, "title": "B"}]},
        {"songs": _songs(MAX_SONGS + 1)},
    ],
    ids=[
        "a title too long",
        "an artist too long",
        "an album too long",
        "a year of two digits",
        "a year past 2999",
        "a year that is a word",
        "a title that is a number",
        "songs that are a word",
        "a start that is a word",
        "a negative start",
        "a blank song title",
        "a song without a title",
        "a song title too long",
        "a song artist too long",
        "starts that fall",
        "starts that repeat",
        "starts less than a second apart",
        "a start more than a week in",
        "too many songs",
    ],
)
def test_an_answer_over_the_limits_is_bad(answer: dict[str, Any]) -> None:
    with pytest.raises(BadAnswerError):
        parse_answer(say(answer))


def test_as_many_songs_as_a_song_list_may_hold_are_read() -> None:
    songs = parse_answer(say({"songs": _songs(MAX_SONGS)})).suggested_songs()

    assert len(songs) == MAX_SONGS


def test_a_list_of_one_song_is_no_song_list() -> None:
    answer = parse_answer(say({"title": "Night Drive", "songs": _songs(1)}))

    assert answer.suggested_songs() == ()


@pytest.mark.parametrize("text", ["", "not json", "[1, 2]", '"text"', "null", '{"title": '])
def test_text_that_is_not_a_json_object_is_bad(text: str) -> None:
    with pytest.raises(BadAnswerError):
        parse_answer(text)


def test_a_bad_answer_names_the_fields_that_failed_and_not_what_was_said() -> None:
    with pytest.raises(BadAnswerError) as bad:
        parse_answer(say({"title": "t" * 513, "year": 99}))

    assert "title" in str(bad.value)
    assert "year" in str(bad.value)
    assert "ttttt" not in str(bad.value)


def test_an_answer_that_is_not_json_says_so() -> None:
    with pytest.raises(BadAnswerError, match="not valid JSON"):
        parse_answer("Sure! Here is the song.")
