"""The enricher extension point: its models, and its contract kit."""

from pathlib import Path

import pytest
from pydantic import ValidationError

from medleyplay.plugin_api import (
    AiEndpoint,
    Enriched,
    EnrichStatus,
    EnrichTrack,
    ShownDetail,
    SuggestedSong,
    VideoText,
)
from medleyplay.plugin_api.testing import ContractError, check_track_enricher


class Enricher:
    """An enricher that answers `answer`, after writing `files` into the request's folder."""

    def __init__(self, answer: Enriched, files: dict[str, str] | None = None) -> None:
        self.answer = answer
        self.files = files or {}

    def enrich(self, request: EnrichTrack) -> Enriched:
        for name, text in self.files.items():
            (Path(request.folder) / name).write_text(text, encoding="utf-8")
        return self.answer


def _ask(folder: Path) -> EnrichTrack:
    return EnrichTrack(video="BV1AC4y1L7Yi", folder=str(folder))


def test_an_answer_holds_values_or_the_videos_text_not_both() -> None:
    with pytest.raises(ValidationError, match="values or the video's text"):
        Enriched(values={"genre": "Vocaloid"}, video_text=VideoText(title="Melt"))


def test_a_video_id_that_is_a_path_is_refused(tmp_path: Path) -> None:
    with pytest.raises(ValidationError):
        EnrichTrack(video="../etc/passwd", folder=str(tmp_path))


def test_an_ask_without_a_video_names_a_track_by_what_it_shows(tmp_path: Path) -> None:
    ask = EnrichTrack(
        shown=(ShownDetail(field="title", value="Let Down", origin="files"),),
        folder=str(tmp_path),
    )

    assert (ask.video, ask.whole_album) == (None, False)


def test_an_answer_with_text_and_a_cover_in_the_folder_keeps_the_contract(tmp_path: Path) -> None:
    enricher = Enricher(Enriched(video_text=VideoText(title="Melt"), cover="cover"), {"cover": "x"})

    answer = check_track_enricher(enricher, _ask(tmp_path))

    assert answer.cover == "cover"


@pytest.mark.parametrize("status", [EnrichStatus.GONE, EnrichStatus.REFUSED, EnrichStatus.INVALID])
def test_an_answer_that_is_not_ok_holds_nothing_else(tmp_path: Path, status: EnrichStatus) -> None:
    answer = Enriched(status=status, message="No.")

    assert check_track_enricher(Enricher(answer), _ask(tmp_path)) == answer


@pytest.mark.parametrize(
    "answer",
    [
        Enriched(status=EnrichStatus.GONE, values={"genre": "Pop"}),
        Enriched(status=EnrichStatus.REFUSED, video_text=VideoText(title="Melt")),
        Enriched(status=EnrichStatus.GONE, cover="cover"),
        Enriched(status=EnrichStatus.INVALID, songs=(SuggestedSong(start_ms=0, title="Intro"),)),
    ],
)
def test_an_answer_that_is_not_ok_but_holds_something_breaks_the_contract(
    tmp_path: Path, answer: Enriched
) -> None:
    with pytest.raises(ContractError, match="holds values, text, songs, or a cover"):
        check_track_enricher(Enricher(answer), _ask(tmp_path))


def test_a_cover_named_outside_the_folder_breaks_the_contract(tmp_path: Path) -> None:
    enricher = Enricher(Enriched(cover="../cover"))

    with pytest.raises(ContractError, match="isn't a bare file name"):
        check_track_enricher(enricher, _ask(tmp_path))


def test_a_cover_that_is_not_in_the_folder_breaks_the_contract(tmp_path: Path) -> None:
    enricher = Enricher(Enriched(cover="cover"))

    with pytest.raises(ContractError, match="isn't a file in the folder"):
        check_track_enricher(enricher, _ask(tmp_path))


def test_an_answer_holds_values_and_the_songs_it_suggests() -> None:
    answer = Enriched(
        values={"title": "Night Drive"},
        songs=(
            SuggestedSong(start_ms=0, title="Intro"),
            SuggestedSong(start_ms=192_000, title="Night Drive", artist="Blue Room"),
        ),
    )

    assert [song.title for song in answer.songs] == ["Intro", "Night Drive"]


def test_an_answer_suggests_at_most_three_hundred_songs() -> None:
    songs = tuple(SuggestedSong(start_ms=each * 1_000, title="Song") for each in range(301))

    with pytest.raises(ValidationError, match="at most 300"):
        Enriched(songs=songs)


def test_a_suggested_song_does_not_start_before_the_file() -> None:
    with pytest.raises(ValidationError):
        SuggestedSong(start_ms=-1, title="Intro")


def _deepseek() -> AiEndpoint:
    return AiEndpoint(base_url="https://api.deepseek.com", model="deepseek-flash", key="sk-1234")


def test_an_ask_for_a_suggestion_carries_the_videos_text_and_the_provider(tmp_path: Path) -> None:
    ask = EnrichTrack(
        text=VideoText(title="Night Drive / Blue Room"),
        ai=(
            AiEndpoint(base_url="https://api.deepseek.com", model="deepseek-flash", key="sk-1234"),
        ),
        folder=str(tmp_path),
    )

    assert ask.text is not None
    assert ask.text.title == "Night Drive / Blue Room"
    assert [(each.base_url, each.model) for each in ask.ai] == [
        ("https://api.deepseek.com", "deepseek-flash")
    ]


def test_an_ask_shows_no_key_when_printed(tmp_path: Path) -> None:
    ask = EnrichTrack(
        ai=(
            AiEndpoint(base_url="https://api.deepseek.com", model="deepseek-flash", key="sk-1234"),
        ),
        folder=str(tmp_path),
    )

    assert "sk-1234" not in repr(ask)
    assert "sk-1234" not in repr(ask.ai)


def test_a_provider_that_needs_no_key_is_one_without() -> None:
    endpoint = AiEndpoint(base_url="http://127.0.0.1:11434/v1", model="llama3.2")

    assert endpoint.key is None
