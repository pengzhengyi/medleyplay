"""The enricher extension point: its models, and its contract kit."""

from pathlib import Path

import pytest
from pydantic import ValidationError

from medleyplay.plugin_api import (
    Enriched,
    EnrichStatus,
    EnrichTrack,
    ShownDetail,
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


@pytest.mark.parametrize("status", [EnrichStatus.GONE, EnrichStatus.REFUSED])
def test_an_answer_that_is_gone_or_refused_holds_nothing_else(
    tmp_path: Path, status: EnrichStatus
) -> None:
    answer = Enriched(status=status, message="No.")

    assert check_track_enricher(Enricher(answer), _ask(tmp_path)) == answer


@pytest.mark.parametrize(
    "answer",
    [
        Enriched(status=EnrichStatus.GONE, values={"genre": "Pop"}),
        Enriched(status=EnrichStatus.REFUSED, video_text=VideoText(title="Melt")),
        Enriched(status=EnrichStatus.GONE, cover="cover"),
    ],
)
def test_an_answer_that_is_not_ok_but_holds_something_breaks_the_contract(
    tmp_path: Path, answer: Enriched
) -> None:
    with pytest.raises(ContractError, match="holds values, text, or a cover"):
        check_track_enricher(Enricher(answer), _ask(tmp_path))


def test_a_cover_named_outside_the_folder_breaks_the_contract(tmp_path: Path) -> None:
    enricher = Enricher(Enriched(cover="../cover"))

    with pytest.raises(ContractError, match="isn't a bare file name"):
        check_track_enricher(enricher, _ask(tmp_path))


def test_a_cover_that_is_not_in_the_folder_breaks_the_contract(tmp_path: Path) -> None:
    enricher = Enricher(Enriched(cover="cover"))

    with pytest.raises(ContractError, match="isn't a file in the folder"):
        check_track_enricher(enricher, _ask(tmp_path))
