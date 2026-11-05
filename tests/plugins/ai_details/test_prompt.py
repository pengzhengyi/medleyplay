"""The messages sent to the model: the shape asked for, and the Track's video text as data."""

from pathlib import Path

from medleyplay.plugin_api import Chapter, EnrichTrack, ShownDetail, VideoText
from medleyplay.plugins.ai_details.models import parse_answer
from medleyplay.plugins.ai_details.prompt import EXAMPLE, SYSTEM, asking, asking_again
from tests.support.ai import KEY, AiEndpointFactory
from tests.support.factories import EnrichTrackFactory


def _ask(tmp_path: Path, **change: object) -> EnrichTrack:
    return EnrichTrackFactory.night_drive_video(tmp_path, AiEndpointFactory.deepseek()).model_copy(
        update=change
    )


def test_the_system_message_says_json_and_shows_the_shape_of_the_answer() -> None:
    assert "json" in SYSTEM.lower()
    assert EXAMPLE in SYSTEM


def test_the_example_shape_is_one_the_answer_is_checked_with() -> None:
    answer = parse_answer(EXAMPLE)

    assert answer.title is not None
    assert len(answer.suggested_songs()) == 2


def test_the_system_message_says_the_video_text_is_data_not_instructions() -> None:
    assert "not instructions" in SYSTEM


def test_the_messages_are_a_system_message_then_one_user_message(tmp_path: Path) -> None:
    messages = asking(_ask(tmp_path))

    assert [message["role"] for message in messages] == ["system", "user"]
    assert messages[0]["content"] == SYSTEM


def test_the_user_message_holds_the_title_the_file_name_the_length_and_what_is_shown(
    tmp_path: Path,
) -> None:
    user = asking(_ask(tmp_path))[1]["content"]

    assert user == (
        "Video title: 【MV】Night Drive / Blue Room\n"
        "File name: BV1dm4y1s7ak.m4a\n"
        "Length: 4:59\n"
        "Details shown now:\n"
        "- title: BV1dm4y1s7ak (file_name)\n"
        "Description:\n"
        "Re:Start, 2016"
    )


def test_the_chapters_are_listed_with_their_starts(tmp_path: Path) -> None:
    text = VideoText(
        title="Re:Start",
        chapters=(
            Chapter(start_ms=0, title="Intro"),
            Chapter(start_ms=192_000, title="Night Drive"),
            Chapter(start_ms=4_060_000, title="Outro"),
        ),
    )

    user = asking(_ask(tmp_path, text=text))[1]["content"]

    assert user.endswith("Chapters:\n0:00 Intro\n3:12 Night Drive\n1:07:40 Outro")


def test_a_part_the_track_lacks_is_left_out(tmp_path: Path) -> None:
    ask = _ask(
        tmp_path, text=VideoText(title="Night Drive"), shown=(), file_name="", duration_ms=None
    )

    assert asking(ask)[1]["content"] == "Video title: Night Drive"


def test_a_length_over_an_hour_has_hours(tmp_path: Path) -> None:
    ask = _ask(tmp_path, duration_ms=3_723_000)

    assert "Length: 1:02:03\n" in asking(ask)[1]["content"]


def test_every_shown_detail_is_listed_with_its_origin(tmp_path: Path) -> None:
    shown = (
        ShownDetail(field="artist", value="Blue Room", origin="files"),
        ShownDetail(field="year", value=2016, origin="files"),
    )

    user = asking(_ask(tmp_path, shown=shown))[1]["content"]

    assert "- artist: Blue Room (files)\n- year: 2016 (files)\n" in user


def test_the_key_is_in_no_message(tmp_path: Path) -> None:
    messages = asking(_ask(tmp_path))

    assert KEY not in "".join(message["content"] for message in messages)


def test_asking_again_keeps_the_first_messages_adds_the_bad_answer_and_names_the_problems(
    tmp_path: Path,
) -> None:
    first = asking(_ask(tmp_path))

    again = asking_again(
        first, '{"year": 99}', "year: Input should be greater than or equal to 1000"
    )

    assert again[:2] == first
    assert again[2] == {"role": "assistant", "content": '{"year": 99}'}
    assert again[3]["role"] == "user"
    assert "year: Input should be greater than or equal to 1000" in again[3]["content"]
    assert "json" in again[3]["content"].lower()
