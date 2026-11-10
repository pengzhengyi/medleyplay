"""The AI provider's address, model, and key are checked, and the key is redacted from text."""

import pytest
from hypothesis import assume, given
from hypothesis import strategies as st

from medleyplay import plugin_api
from medleyplay.domain.ai import (
    MAX_CHAPTER_TITLE,
    MAX_CHAPTERS,
    MAX_DESCRIPTION,
    MAX_HINT,
    MAX_KEY,
    MAX_MODEL,
    MAX_URL,
    MIN_KEY,
    PRESETS,
    check_base_url,
    check_hint,
    check_key,
    check_model,
    cut_text,
    is_loopback,
    redact_key,
)
from medleyplay.domain.errors import InvalidInputError
from medleyplay.domain.linked_accounts import REDACTED
from medleyplay.domain.video_text import Chapter, VideoText

KEY = "sk-9f8e7d6c5b4a"


@pytest.mark.parametrize(
    ("written", "kept"),
    [
        ("https://api.deepseek.com", "https://api.deepseek.com"),
        ("https://api.openai.com/v1", "https://api.openai.com/v1"),
        ("https://api.openai.com/v1/", "https://api.openai.com/v1"),
        ("  https://api.anthropic.com/v1  ", "https://api.anthropic.com/v1"),
        ("HTTPS://API.Example.COM/V1", "https://api.example.com/V1"),
        ("https://gateway.lan:8443/ai/v1", "https://gateway.lan:8443/ai/v1"),
        ("http://127.0.0.1:11434/v1", "http://127.0.0.1:11434/v1"),
        ("http://localhost:11434/v1", "http://localhost:11434/v1"),
        ("http://[::1]:11434/v1", "http://[::1]:11434/v1"),
    ],
)
def test_a_base_url_is_kept_without_its_trailing_slash(written: str, kept: str) -> None:
    assert check_base_url(written) == kept


@pytest.mark.parametrize(
    "written",
    [
        "",
        "api.deepseek.com",
        "ftp://api.deepseek.com",
        "https://",
        "https:///v1",
        "https://alice@api.deepseek.com",
        "https://alice:swordfish@api.deepseek.com",
        "https://api.deepseek.com/v1?key=abc",
        "https://api.deepseek.com/v1#top",
        "https://api.deepseek.com/v1?",
        "https://api.deepseek.com/ v1",
        "https://api.deepseek.com/v\n1",
        "https://api.deepseek.com:99999",
        "https://api.deepseek.com:http",
        "https://" + "a" * MAX_URL + ".com",
    ],
    ids=[
        "empty",
        "no scheme",
        "other scheme",
        "no host",
        "no host before a path",
        "a user name",
        "a login",
        "a query",
        "a fragment",
        "an empty query",
        "a space",
        "a control character",
        "a port out of range",
        "a port that is a word",
        "too long",
    ],
)
def test_a_base_url_that_is_not_a_plain_http_or_https_address_is_refused(written: str) -> None:
    with pytest.raises(InvalidInputError):
        check_base_url(written)


@pytest.mark.parametrize(
    "written",
    [
        "http://api.deepseek.com",
        "http://192.168.1.20:11434/v1",
        "http://ollama.lan:11434/v1",
        "http://localhost.example.com/v1",
        "http://127.0.0.1.example.com/v1",
    ],
)
def test_plain_http_is_refused_unless_the_address_is_on_this_machine(written: str) -> None:
    with pytest.raises(InvalidInputError, match="https"):
        check_base_url(written)


def test_a_refused_base_url_is_not_repeated_in_the_reason() -> None:
    with pytest.raises(InvalidInputError) as refused:
        check_base_url("https://alice:swordfish@api.deepseek.com")

    assert "swordfish" not in str(refused.value)


@pytest.mark.parametrize(
    ("address", "loopback"),
    [
        ("http://127.0.0.1:11434/v1", True),
        ("http://127.1.2.3/v1", True),
        ("http://localhost/v1", True),
        ("http://LOCALHOST:11434/v1", True),
        ("http://[::1]:11434/v1", True),
        ("https://api.deepseek.com", False),
        ("http://192.168.1.20/v1", False),
        ("http://[2001:db8::1]/v1", False),
    ],
)
def test_an_address_is_on_this_machine_when_its_host_is_a_loopback_name_or_address(
    address: str, *, loopback: bool
) -> None:
    assert is_loopback(address) is loopback


def test_every_preset_is_an_address_and_a_model_a_household_could_enter() -> None:
    for preset in PRESETS:
        assert check_base_url(preset.base_url) == preset.base_url
        assert check_model(preset.model) == preset.model


def test_the_presets_are_deepseek_openai_anthropic_and_ollama_in_that_order() -> None:
    assert [(preset.name, preset.base_url) for preset in PRESETS] == [
        ("DeepSeek", "https://api.deepseek.com"),
        ("OpenAI", "https://api.openai.com/v1"),
        ("Anthropic", "https://api.anthropic.com/v1"),
        ("Ollama", "http://127.0.0.1:11434/v1"),
    ]


@pytest.mark.parametrize(
    ("written", "kept"),
    [
        ("deepseek-flash", "deepseek-flash"),
        ("  gpt-4o-mini ", "gpt-4o-mini"),
        ("llama3.2:3b", "llama3.2:3b"),
    ],
)
def test_a_model_name_is_trimmed(written: str, kept: str) -> None:
    assert check_model(written) == kept


@pytest.mark.parametrize(
    "written",
    ["", "   ", "gpt 4o", "gpt\n4o", "m" * (MAX_MODEL + 1)],
    ids=["empty", "blank", "a space", "a control character", "too long"],
)
def test_a_model_name_that_is_blank_has_a_space_or_is_too_long_is_refused(written: str) -> None:
    with pytest.raises(InvalidInputError):
        check_model(written)


def test_a_key_is_trimmed() -> None:
    assert check_key(f"  {KEY}\n") == KEY


@pytest.mark.parametrize(
    "written",
    ["", "   ", "k" * (MIN_KEY - 1), "sk-9f8e 7d6c5b4a", "sk-9f8e\t7d6c5b4a", "k" * (MAX_KEY + 1)],
    ids=["empty", "blank", "too short", "a space", "a tab", "too long"],
)
def test_a_key_that_is_blank_too_short_too_long_or_has_a_space_is_refused(written: str) -> None:
    with pytest.raises(InvalidInputError):
        check_key(written)


def test_a_refused_key_is_not_repeated_in_the_reason() -> None:
    with pytest.raises(InvalidInputError) as refused:
        check_key("sk-9f8e 7d6c5b4a")

    assert "9f8e" not in str(refused.value)


def test_a_key_in_text_is_replaced() -> None:
    text = f"The provider said: invalid key {KEY}."

    assert redact_key(text, KEY) == "The provider said: invalid key <redacted>."


def test_text_is_left_as_it_is_when_there_is_no_key() -> None:
    assert redact_key("Nothing secret.", None) == "Nothing secret."


@given(st.text(), st.text(alphabet="abcdef0123456789-_", min_size=MIN_KEY, max_size=40))
def test_no_text_keeps_the_key_it_was_redacted_of(text: str, key: str) -> None:
    assume(key not in REDACTED)

    assert key not in redact_key(f"{text}{key}{text}", key)


def test_a_text_within_the_limits_is_sent_as_it_is() -> None:
    text = VideoText(
        "Re:Start", "Blue Room, 2016", (Chapter(0, "Intro"), Chapter(192_000, "Night Drive"))
    )

    assert cut_text(text) == text


def test_a_description_is_cut_to_the_limit() -> None:
    text = VideoText("Re:Start", "d" * (MAX_DESCRIPTION + 1))

    assert cut_text(text).description == "d" * MAX_DESCRIPTION


def test_the_chapters_are_cut_to_the_limit_and_so_is_each_title() -> None:
    chapters = tuple(
        Chapter(each * 1_000, "c" * (MAX_CHAPTER_TITLE + 1)) for each in range(MAX_CHAPTERS + 1)
    )

    cut = cut_text(VideoText("Re:Start", chapters=chapters))

    assert len(cut.chapters) == MAX_CHAPTERS
    assert {chapter.title for chapter in cut.chapters} == {"c" * MAX_CHAPTER_TITLE}
    assert [chapter.start_ms for chapter in cut.chapters] == [
        each * 1_000 for each in range(MAX_CHAPTERS)
    ]


def test_the_title_is_never_cut() -> None:
    text = VideoText("t" * 1_000)

    assert cut_text(text).title == "t" * 1_000


def test_a_hint_keeps_its_words_on_one_line() -> None:
    hint = check_hint("  The 2007 concert.\n\tIt has 22 songs.  ")

    assert hint == "The 2007 concert. It has 22 songs."


def test_a_hint_loses_its_control_characters() -> None:
    assert check_hint("22\x00 songs\x1b") == "22 songs"


def test_a_hint_over_the_limit_is_refused() -> None:
    with pytest.raises(InvalidInputError, match="500 characters"):
        check_hint("h" * (MAX_HINT + 1))


def test_a_note_to_the_ai_has_one_limit_in_the_core_and_the_plugin_api() -> None:
    assert MAX_HINT == plugin_api.MAX_HINT
