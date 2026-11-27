"""Identify language hints for original lyrics and their timed translations."""

# cspell:ignore kaze omoide yume yureru

import pytest

from medleyplay.application.lyrics_language import lyrics_languages


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        (
            """\
            [00:01.00]You are here with me
            [00:02.00]The light is yours
            [00:01.00]你在这里
            [00:02.00]灯光为你亮起
            """,
            ("en", "zh-Hans", True),
        ),
        (
            """\
            [00:01.00]바람이 분다
            [00:02.00]불빛이 흔들린다
            [00:01.00]With thanks to the editor
            """,
            ("ko", None, True),
        ),
        (
            """\
            [00:01.00]You are here with me
            [00:02.00]The light is yours
            [00:01.00]You are here with me
            [00:02.00]The light is yours
            """,
            ("en", None, False),
        ),
        (
            """\
            [00:01.00]あおい空
            [00:02.00]ゆれる灯
            [00:01.00]aoi sora
            [00:02.00]yureru hi
            """,
            ("ja", None, True),
        ),
        (
            """\
            [00:01.00]夢のように
            [00:02.00]風のように
            [00:01.00]yume no you ni
            [00:02.00]kaze no you ni
            """,
            ("ja", None, True),
        ),
        (
            """\
            [00:01.00]あおい空
            [00:02.00]ゆれる灯
            [00:03.00]おもい出
            [00:04.00]やさしい風
            [00:01.00]aoi sora
            [00:02.00]yureru hi
            [00:03.00]omoide
            [00:04.00]With thanks to the editor
            """,
            ("ja", None, True),
        ),
        (
            """\
            [00:01.00]あおい空
            [00:02.00]ゆれる灯
            [00:03.00]With you
            [00:01.00]天空留下光
            [00:02.00]一盏小灯
            [00:03.00]夜色温柔
            """,
            ("ja", "zh-Hans", True),
        ),
    ],
    ids=[
        "paired-chinese",
        "single-credit",
        "repeated-original",
        "romanization",
        "romanization-with-english-looking-word",
        "romanization-with-credit",
        "mixed-language-refrain",
    ],
)
def test_only_recognizable_language_paired_in_time_is_a_translation_hint(
    text: str, expected: tuple[str | None, str | None, bool]
) -> None:
    hints = lyrics_languages(text)

    assert (hints.primary, hints.translation, hints.has_paired_text) == expected
