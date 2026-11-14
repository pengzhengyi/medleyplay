"""The AI providers the household sets up: where each is, which model to ask, and the key.

A provider speaks the OpenAI chat protocol, as DeepSeek, OpenAI, Anthropic, and a
local Ollama all do, so a household chooses one with a base URL and a model:

```text
DeepSeek    https://api.deepseek.com          deepseek-flash
OpenAI      https://api.openai.com/v1         gpt-4o-mini
Ollama      http://127.0.0.1:11434/v1         llama3.2
```

The household keeps up to `MAX_PROVIDERS`, in order: a Job asks the first, and the
next when one fails. A key is a secret, so the Keychain keeps it and the catalog
keeps only the name it is kept under. Nothing here reaches a network, and no reason
repeats what was typed.
"""

import ipaddress
from dataclasses import dataclass
from enum import StrEnum
from typing import Final, NoReturn
from urllib.parse import urlsplit

from medleyplay.domain.errors import InvalidInputError
from medleyplay.domain.linked_accounts import REDACTED
from medleyplay.domain.video_text import MAX_SONGS, Chapter, VideoText

MAX_URL: Final = 256
MAX_MODEL: Final = 128
MIN_KEY: Final = 4
MAX_KEY: Final = 512
MAX_DESCRIPTION: Final = 6_000
"""The most characters of a video's description sent to the provider."""
MAX_CHAPTERS: Final = MAX_SONGS
"""The most chapters sent: as many as a song list holds."""
MAX_CHAPTER_TITLE: Final = 200
MAX_PROVIDERS: Final = 5
MAX_HINT: Final = 500
"""The longest note a listener adds when asking the AI again."""
"""The most providers kept; a Job reads the key of each from the Keychain."""
KEY_SECRET: Final = "ai:key"  # noqa: S105 -- the name of a Keychain item, not a key
"""The name the key of a provider set up when only one could be is kept under."""
_LOOPBACK_NAMES: Final = frozenset({"localhost"})


class ProviderFailure(StrEnum):
    """Why a provider last gave no answer to use."""

    UNREACHABLE = "unreachable"
    """It couldn't be reached, or something else answered in its place."""
    BUSY = "busy"
    """It stayed busy or kept failing."""
    REFUSED = "refused"
    """It refused the key or the account."""
    UNUSABLE = "unusable"
    """It answered, but not with what was asked: a wrong model or address, or a bad answer."""
    KEY_MISSING = "key_missing"
    """Its key is no longer in the Keychain, so it isn't asked until the key is replaced."""


class UnusableReason(StrEnum):
    """What was wrong with an unusable answer."""

    REJECTED = "rejected"
    """It refused the request, with the status kept: a wrong model or address."""
    REDIRECTED = "redirected"
    """It answered with a redirect, which isn't followed: a wrong address."""
    CUT_OFF = "cut_off"
    """The model ran out of room before it finished its answer."""
    EMPTY = "empty"
    """The answer was empty, or no chat reply."""
    NOT_JSON = "not_json"
    """The answer was not the JSON asked for, even when asked again."""


@dataclass(frozen=True)
class ProviderFailed:
    """Why a provider gave no answer to use, and for an unusable one, what was wrong."""

    failure: ProviderFailure
    reason: UnusableReason | None = None
    status: int | None = None
    """The status of a request the provider refused."""


@dataclass(frozen=True)
class Preset:
    """A provider a household can start from: its name, base URL, and a model to ask."""

    name: str
    base_url: str
    model: str


PRESETS: Final = (
    Preset("DeepSeek", "https://api.deepseek.com", "deepseek-flash"),
    Preset("OpenAI", "https://api.openai.com/v1", "gpt-4o-mini"),
    Preset("Anthropic", "https://api.anthropic.com/v1", "claude-haiku-5-5"),
    Preset("Ollama", "http://127.0.0.1:11434/v1", "llama3.2"),
)


def key_secret(provider_id: str) -> str:
    """Return the name the key of the provider `provider_id` is kept under in the Keychain."""
    return f"{KEY_SECRET}:{provider_id}"


def check_base_url(text: str) -> str:
    """Return the base URL `text` writes, or raise `InvalidInputError` without repeating `text`.

    It is `http` or `https` with a host, and no login, query, or fragment; `http` is
    for an address on this machine only. A trailing `/` is dropped:
    "https://api.openai.com/v1/" gives "https://api.openai.com/v1".
    """
    address = text.strip()
    if not address or len(address) > MAX_URL:
        _refuse(f"The base URL is at most {MAX_URL} characters.")
    if any(each.isspace() or not each.isprintable() for each in address):
        _refuse("The base URL has no spaces or control characters.")
    if "?" in address or "#" in address:
        _refuse("The base URL has no query or fragment.")
    try:
        parts = urlsplit(address)
        parts.port  # noqa: B018 -- reading it raises ValueError for a port that is no number
    except ValueError:
        _refuse("The base URL is like https://api.deepseek.com or http://127.0.0.1:11434/v1.")
    if parts.scheme not in {"http", "https"} or not parts.hostname:
        _refuse("The base URL is like https://api.deepseek.com or http://127.0.0.1:11434/v1.")
    if "@" in parts.netloc:
        _refuse("The base URL has no login; the key is entered apart.")
    kept = f"{parts.scheme}://{parts.netloc.lower()}{parts.path.rstrip('/')}"
    if parts.scheme == "http" and not is_loopback(kept):
        _refuse("The base URL is https unless it is on this machine.")
    return kept


def is_loopback(base_url: str) -> bool:
    """Return whether the address is on this machine: `localhost`, `127.0.0.1`, or `::1`."""
    host = urlsplit(base_url).hostname or ""
    if host in _LOOPBACK_NAMES:
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def check_model(text: str) -> str:
    """Return the model name `text` writes, trimmed, or raise `InvalidInputError`."""
    model = text.strip()
    if not model or len(model) > MAX_MODEL:
        _refuse(f"The model is a name of at most {MAX_MODEL} characters.")
    if any(each.isspace() or not each.isprintable() for each in model):
        _refuse("The model has no spaces or control characters.")
    return model


def check_key(text: str) -> str:
    """Return the key `text` holds, trimmed, or raise `InvalidInputError` without repeating it."""
    key = text.strip()
    if not MIN_KEY <= len(key) <= MAX_KEY:
        _refuse(f"A key is from {MIN_KEY} to {MAX_KEY} characters.")
    if any(each.isspace() or not each.isprintable() for each in key):
        _refuse("A key has no spaces or control characters.")
    return key


def cut_text(text: VideoText) -> VideoText:
    """Return the video's text as it is sent to the provider, cut to the limits.

    The description keeps its first `MAX_DESCRIPTION` characters, and at most
    `MAX_CHAPTERS` chapters are kept, each title cut to `MAX_CHAPTER_TITLE`.
    """
    chapters = tuple(
        Chapter(chapter.start_ms, chapter.title[:MAX_CHAPTER_TITLE])
        for chapter in text.chapters[:MAX_CHAPTERS]
    )
    return VideoText(text.title, text.description[:MAX_DESCRIPTION], chapters)


def check_hint(text: str) -> str:
    """Return a listener's note to the AI on one line, its control characters gone.

    Every run of white space becomes one space; a note longer than `MAX_HINT`
    characters is refused.
    """
    kept = "".join(each for each in text if each.isspace() or each.isprintable())
    hint = " ".join(kept.split())
    if len(hint) > MAX_HINT:
        _refuse(f"A note to the AI is at most {MAX_HINT} characters.")
    return hint


def redact_key(text: str, key: str | None) -> str:
    """Return `text` with every copy of `key` replaced."""
    if not key:
        return text
    while key in text:
        text = text.replace(key, REDACTED)
    return text


def _refuse(why: str) -> NoReturn:
    raise InvalidInputError(why) from None
