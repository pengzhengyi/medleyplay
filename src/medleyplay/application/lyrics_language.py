"""Describe languages in a lyric candidate without sending its words to a chooser."""

import re
from collections import Counter
from dataclasses import dataclass
from typing import Final

from medleyplay.domain.errors import InvalidInputError
from medleyplay.domain.lyrics import parse_lyrics
from medleyplay.plugin_api import LyricLanguageHint

_KANA: Final = re.compile(r"[\u3041-\u3096\u30a1-\u30fa]")
_HANGUL: Final = re.compile(r"[\uac00-\ud7a3]")
_HAN: Final = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff]")
_LATIN_WORD: Final = re.compile(r"\b[a-z]+\b")
_ENGLISH: Final = frozenset(
    ("the", "your", "with", "when", "what", "and", "that", "from", "this", "there", "would")
)
_SIMPLIFIED: Final = frozenset("们这过说让时还个为样从对经发觉开见问听长飞爱盏")
_MIN_ENGLISH_MARKERS: Final = 2
_MIN_PAIRED_LINES: Final = 2
_MIN_LINE_SHARE: Final = 0.5


@dataclass(frozen=True)
class LyricsLanguages:
    """Language hints and whether the candidate has separate text at the same times."""

    primary: LyricLanguageHint | None = None
    translation: LyricLanguageHint | None = None
    has_paired_text: bool = False


def lyrics_languages(text: str) -> LyricsLanguages:
    """Return hints for the primary lyrics and a translation paired with them in time."""
    try:
        lyrics = parse_lyrics(text)
    except InvalidInputError:
        return LyricsLanguages()
    if not lyrics.synced:
        return LyricsLanguages(primary=_language_of(lyrics.plain.splitlines()))
    lines = [line for line in lyrics.lines if line.text.strip()]
    primary = _language_of([line.text for line in lines])
    paired = [line.translation for line in lines if line.translation.strip() not in ("", line.text)]
    translation = _language_of(paired, minimum=max(_MIN_PAIRED_LINES, len(lines) * _MIN_LINE_SHARE))
    return LyricsLanguages(
        primary=primary,
        translation=translation if primary is not None and primary != translation else None,
        has_paired_text=bool(paired),
    )


def _language_of(lines: list[str], *, minimum: float = 1) -> LyricLanguageHint | None:
    written = [line for line in lines if line.strip()]
    simplified = any(
        not _KANA.search(line) and not _HANGUL.search(line) and not _SIMPLIFIED.isdisjoint(line)
        for line in written
    )
    counts = Counter(
        hint for line in written if (hint := _line_hint(line, simplified=simplified)) is not None
    )
    prominent = counts.most_common(2)
    if not prominent:
        return None
    (language, count), *others = prominent
    if count < max(minimum, len(written) * _MIN_LINE_SHARE) or any(
        other == count for _, other in others
    ):
        return None
    if language == "en" and len(_english_markers("\n".join(written))) < _MIN_ENGLISH_MARKERS:
        return None
    return language


def _line_hint(line: str, *, simplified: bool) -> LyricLanguageHint | None:
    if _KANA.search(line):
        return "ja"
    if _HANGUL.search(line):
        return "ko"
    if simplified and _HAN.search(line):
        return "zh-Hans"
    if _english_markers(line):
        return "en"
    return None


def _english_markers(text: str) -> frozenset[str]:
    return _ENGLISH.intersection(_LATIN_WORD.findall(text.lower()))
