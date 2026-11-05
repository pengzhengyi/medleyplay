"""The enrich program: asking the enricher, and trusting a cover only once it proves to be one."""

from pathlib import Path

import pytest

from medleyplay.domain.covers import cover_id
from medleyplay.plugin_api import ShownDetail
from medleyplay.plugin_host.job import AnswerFailedError, JobContext
from medleyplay.plugin_host.loader import load_plugins
from medleyplay.programs.enrich_track import EnrichedTrack, EnrichJob, run
from tests.support.hosts import TEST_PLUGINS
from tests.support.images import jpeg_image

PROXY = "socks5h://127.0.0.1:7890"
LET_DOWN = (ShownDetail(field="title", value="Let Down", origin="files"),)


def _context(tmp_path: Path, proxy: str | None = None) -> JobContext:
    """A Job's context in this process, asking the test plugin `reader`."""
    work_dir = tmp_path / "work"
    work_dir.mkdir()
    endpoints = load_plugins(TEST_PLUGINS, ["reader"], lambda _: None)
    return JobContext(work_dir, endpoints, lambda _: None, proxy=proxy)


def _ask(video: str) -> EnrichJob:
    return EnrichJob(enricher="bilibili-details", subject=video, video=video)


def test_the_answer_is_the_videos_text_without_a_cover_when_the_enricher_wrote_none(
    tmp_path: Path,
) -> None:
    found = run(_ask("BVNoCover"), _context(tmp_path))

    assert found.video_text is not None
    assert found.video_text.title == "Night Drive / Blue Room"
    assert found.cover is None


def test_the_cover_is_copied_under_the_name_of_its_bytes_into_the_jobs_folder(
    tmp_path: Path,
) -> None:
    found = run(_ask("BV1AC4y1L7Yi"), _context(tmp_path))

    image = jpeg_image("BV1AC4y1L7Yi")
    assert found.cover is not None
    assert found.cover.name == cover_id(image)
    assert Path(found.cover.path).read_bytes() == image
    assert Path(found.cover.path).parent == tmp_path / "work" / "covers"


def test_values_an_enricher_answers_are_passed_on(tmp_path: Path) -> None:
    found = run(_ask("BVValues"), _context(tmp_path))

    assert found == EnrichedTrack(
        enricher="bilibili-details",
        subject="BVValues",
        values={"genre": "Vocaloid", "year": 2014},
        cover=found.cover,
    )
    assert found.cover is not None


@pytest.mark.parametrize("video", ["BVNotAnImage", "BVEscape", "BVLink", "BVHuge", "BVFolder"])
def test_a_cover_that_is_not_a_plain_image_directly_in_the_folder_is_left_out(
    tmp_path: Path, video: str
) -> None:
    found = run(_ask(video), _context(tmp_path))

    assert found.video_text is not None
    assert found.cover is None
    assert not (tmp_path / "work" / "covers").exists()


def test_a_video_that_is_gone_fails_the_job_as_gone_with_what_the_site_said(
    tmp_path: Path,
) -> None:
    with pytest.raises(AnswerFailedError, match=r"The video was removed\.") as failure:
        run(_ask("BVGone"), _context(tmp_path))

    assert failure.value.kind == "gone"


def test_a_refusal_fails_the_job_as_refused_with_what_the_site_said(tmp_path: Path) -> None:
    with pytest.raises(AnswerFailedError, match=r"HTTP Error 412\.") as failure:
        run(_ask("BVRefused"), _context(tmp_path))

    assert failure.value.kind == "refused"


def test_the_jobs_proxy_is_handed_to_the_enricher(tmp_path: Path) -> None:
    found = run(_ask("BVProxyEcho"), _context(tmp_path, proxy=PROXY))

    assert found.video_text is not None
    assert found.video_text.title == f"proxy={PROXY}"


def test_a_song_is_asked_about_without_a_video_and_its_values_and_cover_are_passed_on(
    tmp_path: Path,
) -> None:
    ask = EnrichJob(enricher="musicbrainz", subject="a key", shown=LET_DOWN)

    found = run(ask, _context(tmp_path))

    assert (found.enricher, found.subject) == ("musicbrainz", "a key")
    assert found.values["album"] == "OK Computer"
    assert found.cover is not None
    assert Path(found.cover.path).read_bytes() == jpeg_image("Let Down")


def test_what_a_track_shows_and_whether_it_is_a_whole_album_reach_the_enricher(
    tmp_path: Path,
) -> None:
    shown = (ShownDetail(field="album", value="Echo", origin="video"),)
    ask = EnrichJob(enricher="musicbrainz", subject="k", shown=shown, whole_album=True)

    found = run(ask, _context(tmp_path))

    assert str(found.values["album"]).startswith("whole_album=True video=None")


def test_a_refusal_by_musicbrainz_fails_the_job_as_refused(tmp_path: Path) -> None:
    shown = (ShownDetail(field="title", value="Refused", origin="files"),)

    with pytest.raises(AnswerFailedError, match=r"HTTP Error 403\.") as failure:
        run(EnrichJob(enricher="musicbrainz", subject="k", shown=shown), _context(tmp_path))

    assert failure.value.kind == "refused"
