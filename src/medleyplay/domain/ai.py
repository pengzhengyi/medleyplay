"""The AI provider the household sets up: where it is, which model to ask, and the key.

The provider speaks the OpenAI chat protocol, as DeepSeek, OpenAI, Anthropic, and a
local Ollama all do, so a household chooses one with a base URL and a model:

```text
DeepSeek    https://api.deepseek.com          deepseek-chat
OpenAI      https://api.openai.com/v1         gpt-4o-mini
Ollama      http://127.0.0.1:11434/v1         llama3.2
```

The key is a secret, so the Keychain keeps it and the catalog keeps only whether
there is one. Nothing here reaches a network, and no reason repeats what was typed.
"""

import ipaddress
from dataclasses import dataclass
from typing import Final, NoReturn
from urllib.parse import urlsplit

from medleyplay.domain.errors import InvalidInputError
from medleyplay.domain.linked_accounts import REDACTED

MAX_URL: Final = 256
MAX_MODEL: Final = 128
MIN_KEY: Final = 4
MAX_KEY: Final = 512
KEY_SECRET: Final = "ai:key"  # noqa: S105 -- the name of a Keychain item, not a key
"""The name the provider's key is kept under in the Keychain."""
_LOOPBACK_NAMES: Final = frozenset({"localhost"})


@dataclass(frozen=True)
class Preset:
    """A provider a household can start from: its name, base URL, and a model to ask."""

    name: str
    base_url: str
    model: str


PRESETS: Final = (
    Preset("DeepSeek", "https://api.deepseek.com", "deepseek-chat"),
    Preset("OpenAI", "https://api.openai.com/v1", "gpt-4o-mini"),
    Preset("Anthropic", "https://api.anthropic.com/v1", "claude-haiku-4-5"),
    Preset("Ollama", "http://127.0.0.1:11434/v1", "llama3.2"),
)


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


def redact_key(text: str, key: str | None) -> str:
    """Return `text` with every copy of `key` replaced."""
    if not key:
        return text
    while key in text:
        text = text.replace(key, REDACTED)
    return text


def _refuse(why: str) -> NoReturn:
    raise InvalidInputError(why) from None
