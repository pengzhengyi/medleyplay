"""An Account resumes an interactive video lookup without looking the video up again."""

# cspell:ignore byteswap execv getpid

import os
import shutil
import subprocess
import sys
from array import array
from concurrent.futures import ThreadPoolExecutor
from itertools import pairwise
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application import downloads as download_app
from medleyplay.domain.jobs import JobId, JobState
from medleyplay.download_limits import MAX_DOWNLOAD_BYTES
from medleyplay.persistence.schema import (
    DownloadRow,
    JobRow,
    SourceRow,
    SplitOfferStateRow,
    TrackRow,
)
from medleyplay.programs.joined_audio import join_tools
from medleyplay.web.deps import Services
from tests.support.api import add_bob, sign_in
from tests.support.plugins.tube import JOIN_RETRY, LONG_PARTS, LONG_VIDEO
from tests.support.sites import Site

LOOKUPS = "/api/links/lookups"
CHOICE = {"parts": [{"part": 2, "title": "Side B", "artist": "Blue Room"}]}


def _ready(client: TestClient, site: Site, code: str) -> str:
    job = JobId(client.post(LOOKUPS, json={"link": code}).json()["id"])
    site.wait_for(job, JobState.SUCCEEDED)
    return f"{LOOKUPS}/{job}"


@pytest.mark.parametrize("layout", ["download", "album", "joined", "edited", "manual"])
def test_one_confirmation_accepts_more_than_fifty_parts_and_queues_the_selected_layout(
    site_client: TestClient,
    site_services: tuple[Site, Services],
    units: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    layout: str,
) -> None:
    site, _ = site_services
    link = "https://www.bilibili.com/video/BVmembers" if layout == "manual" else LONG_VIDEO
    path = _ready(site_client, site, link)
    site.jobs.stop()
    monkeypatch.setattr(download_app, "join_tools", lambda: ("ffmpeg", "ffprobe"))
    gib = 1024**3
    monkeypatch.setattr(
        shutil, "disk_usage", lambda _: SimpleNamespace(total=20 * gib, free=10 * gib)
    )
    parts = list(range(1, LONG_PARTS + 1))
    request: dict[str, object] = {"mode": layout, "parts": parts[::-1]}
    if layout in {"album", "joined"}:
        request["album"] = "Long Mixtape"
    if layout == "joined":
        saved = site_client.put(
            "/api/settings", json={"storage_limit": MAX_DOWNLOAD_BYTES, "revision": 0}
        )
        assert saved.status_code == 200, saved.text
    if layout in {"edited", "manual"}:
        request = {"parts": [{"part": part, "title": f"Part {part}"} for part in parts]}

    response = site_client.post(path, json=request)

    assert response.status_code == 200, response.text
    added = response.json()
    with units() as db:
        jobs = [db.get_one(JobRow, item["job"]["id"]) for item in added]
        if layout == "joined":
            (job,) = jobs
            assert job.request["parts"] == parts
        else:
            assert [item["part"] for item in added] == parts
            assert [job.request["part"] for job in jobs] == parts
    assert site_client.get(path).status_code == 404


def test_one_part_as_an_album_keeps_the_bytes_and_does_not_replace_the_song(
    site_client: TestClient, site_services: tuple[Site, Services], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(download_app, "join_tools", lambda: None)
    site, _ = site_services
    video = "BV17x411w7KC"
    song = site_client.post(_ready(site_client, site, video), json=CHOICE).json()[0]
    selection = {"mode": "joined", "album": "Side B alone", "parts": [2]}

    response = site_client.post(_ready(site_client, site, video), json=selection)

    assert response.status_code == 200, response.text
    (album,) = response.json()
    assert album["track_id"] != song["track_id"]
    site.wait_for(JobId(album["job"]["id"]), JobState.SUCCEEDED)
    site.wait_for(JobId(song["job"]["id"]), JobState.SUCCEEDED)
    audio = site_client.get(f"/api/sources/{album['source_id']}/audio")
    assert audio.status_code == 200
    assert audio.content == site_client.get(f"/api/sources/{song['source_id']}/audio").content
    tracks = {track["id"]: track for track in site_client.get("/api/tracks").json()}
    assert (tracks[album["track_id"]]["kind"], tracks[album["track_id"]]["album"]) == (
        "album",
        "Side B alone",
    )
    assert tracks[song["track_id"]]["title"] == "Side B"
    duplicate = site_client.post(_ready(site_client, site, video), json=selection)
    assert duplicate.json() == [{**album, "job": None}]


def test_playing_a_joined_album_recreates_its_missing_download(
    site_client: TestClient, site_services: tuple[Site, Services]
) -> None:
    site, _ = site_services
    result = site_client.post(
        _ready(site_client, site, "BV17x411w7KC"),
        json={"mode": "joined", "album": "Side B", "parts": [2]},
    )
    assert result.status_code == 200
    (album,) = result.json()
    site.wait_for(JobId(album["job"]["id"]), JobState.SUCCEEDED)
    file = site.downloads.folder / f"{album['source_id']}.m4a"
    original = file.read_bytes()
    file.unlink()

    play = site_client.post(f"/api/tracks/{album['track_id']}/playback")

    assert play.status_code == 200, play.text
    assert play.json()["state"] == "preparing"
    site.wait_for(JobId(play.json()["job_id"]), JobState.SUCCEEDED)
    assert file.read_bytes() == original


@pytest.mark.parametrize("reason", ["tools", "disk"])
def test_an_unstartable_join_keeps_the_lookup_and_creates_nothing(
    site_client: TestClient,
    site_services: tuple[Site, Services],
    units: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    reason: str,
) -> None:
    site, _ = site_services
    path = _ready(site_client, site, "BV17x411w7KC")
    monkeypatch.setattr(
        download_app, "join_tools", lambda: ("ffmpeg", "ffprobe") if reason == "disk" else None
    )
    if reason == "disk":
        monkeypatch.setattr(shutil, "disk_usage", lambda _: SimpleNamespace(total=1024**3, free=0))

    response = site_client.post(path, json={"mode": "joined", "album": "Live", "parts": [1, 3]})

    assert response.status_code == 409, response.text
    assert ("space" if reason == "disk" else "FFmpeg") in response.json()["detail"]
    assert site_client.get(path).status_code == 200
    with units() as db:
        assert db.scalars(select(TrackRow)).all() == []
        assert db.scalars(select(JobRow).where(JobRow.kind == "download_source")).all() == []


def _tone_at(ffmpeg: str, file: Path, second: float) -> int:
    result = subprocess.run(  # noqa: S603 -- FFmpeg decodes audio generated by this test.
        [
            ffmpeg,
            "-v",
            "error",
            "-ss",
            str(second),
            "-i",
            str(file),
            "-t",
            "0.5",
            "-ac",
            "1",
            "-f",
            "s16le",
            "-",
        ],
        capture_output=True,
        check=True,
        timeout=15,
    )
    samples = array("h", result.stdout)
    if sys.byteorder != "little":
        samples.byteswap()
    return sum(a <= 0 < b for a, b in pairwise(samples)) * 2


def test_joined_album_plays_only_the_selected_parts_in_video_order(
    site_client: TestClient, site_services: tuple[Site, Services], units: sessionmaker[Session]
) -> None:
    if (tools := join_tools()) is None:
        pytest.skip("Synthetic concatenation requires FFmpeg and ffprobe.")
    site, _ = site_services
    path = _ready(site_client, site, "BV17x411w7KC")
    selection = {"mode": "joined", "album": "Sessions", "artist": "Trio", "parts": [3, 2]}

    result = site_client.post(path, json=selection)

    assert result.status_code == 200, result.text
    (added,) = result.json()
    site.wait_for(JobId(added["job"]["id"]), JobState.SUCCEEDED)
    with units() as db:
        source = db.get_one(SourceRow, added["source_id"])
        assert source.locator == "BV17x411w7KC/joined/2,3"
        download = db.get_one(DownloadRow, source.id)
        assert download.backend == "ffmpeg"
        album = db.scalars(select(TrackRow)).one()
        assert (album.title, album.album_artist, album.kind) == ("Sessions", "Trio", "album")
        assert album.duration_ms == pytest.approx(2000, abs=75)
        file = site.downloads.folder / download.file_name
    sound = site_client.get(f"/api/sources/{added['source_id']}/audio")
    assert sound.content == file.read_bytes()
    assert _tone_at(tools[0], file, 0.2) == pytest.approx(440, abs=15)
    assert _tone_at(tools[0], file, 1.2) == pytest.approx(660, abs=15)
    assert site_client.get(f"/api/tracks/{added['track_id']}/download").json()["link"] == (
        "https://www.bilibili.com/video/BV17x411w7KC"
    )
    assert (
        site_client.put(
            f"/api/tracks/{added['track_id']}/download?name=separate.m4a", content=sound.content
        ).status_code
        == 409
    )


def test_concurrent_confirmations_of_one_selection_reuse_one_album_and_download(
    site_client: TestClient, site_services: tuple[Site, Services], units: sessionmaker[Session]
) -> None:
    site, _ = site_services
    first, second = (
        _ready(site_client, site, f"https://www.bilibili.com/video/BV17x411w7KC?p={part}")
        for part in (1, 2)
    )
    selection = {"mode": "joined", "album": "Side B", "parts": [2]}

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(
            pool.map(lambda path: site_client.post(path, json=selection), (first, second))
        )

    assert [each.status_code for each in results] == [200, 200]
    assert results[0].json()[0]["track_id"] == results[1].json()[0]["track_id"]
    with units() as db:
        assert len(db.scalars(select(TrackRow)).all()) == 1
        assert len(db.scalars(select(JobRow).where(JobRow.kind == "download_source")).all()) == 1


def test_cancelled_and_failed_joins_leave_no_file_and_a_stale_retry_cannot_replace_success(
    site_client: TestClient, site_services: tuple[Site, Services]
) -> None:
    if join_tools() is None:
        pytest.skip("Synthetic concatenation requires FFmpeg and ffprobe.")
    site, _ = site_services
    held = site.data_dir / "hold-part"
    held.touch()
    response = site_client.post(
        _ready(site_client, site, JOIN_RETRY),
        json={"mode": "joined", "album": "Live", "parts": [2, 3]},
    )
    assert response.status_code == 200, response.text
    (album,) = response.json()
    first = album["job"]["id"]
    source = site.downloads.folder / f"{album['source_id']}.m4a"
    site.wait_for(
        JobId(first),
        JobState.RUNNING,
        until=lambda view: (
            view.progress is not None
            and view.progress.fraction is not None
            and view.progress.fraction > 0.25
        ),
    )
    (download,) = site_client.get("/api/downloads").json()
    assert download["job"]["progress"] == {
        "fraction": 0.375,
        "message": "Downloading part 3 (2/2)",
    }
    other = site_client.post(
        _ready(site_client, site, JOIN_RETRY),
        json={"mode": "joined", "album": "Another session", "parts": [1, 2]},
    )
    assert other.status_code == 200, other.text
    legacy = site_client.post(_ready(site_client, site, JOIN_RETRY), json=CHOICE)
    assert legacy.status_code == 200, legacy.text
    site.wait_for(JobId(legacy.json()[0]["job"]["id"]), JobState.SUCCEEDED)
    assert site.jobs.get_job(JobId(other.json()[0]["job"]["id"])).job.state == JobState.QUEUED
    assert site_client.post(f"/api/jobs/{first}/cancel").status_code == 200
    assert not source.exists()
    held.unlink()

    def retry(job: int) -> int:
        result = site_client.post(f"/api/jobs/{job}/retry")
        assert result.status_code == 200, result.text
        return int(result.json()["id"])

    second = retry(first)
    failed = site.wait_for(JobId(second), JobState.FAILED)
    assert "Part 3" in failed.job.failure_message
    assert not source.exists()
    (site.data_dir / "part-restored").touch()
    site.wait_for(JobId(retry(second)), JobState.SUCCEEDED)
    album_bytes = source.read_bytes()

    refusal = site_client.post(f"/api/jobs/{first}/retry")

    assert refusal.status_code == 409, refusal.text
    assert source.read_bytes() == album_bytes


def _hold_audio_processes(tmp_path: Path, ffmpeg: str, monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep the encoder and decoder alive after they open the album's audio pipe."""
    wrapper = tmp_path / "ffmpeg"
    wrapper.write_text(
        f"""#!{sys.executable}
import os
import sys
import time
from pathlib import Path

for pipe, name in (("pipe:0", "encoder.pid"), ("pipe:1", "decoder.pid")):
    if pipe in sys.argv:
        Path({str(tmp_path)!r}, name).write_text(str(os.getpid()))
        time.sleep(60)
        sys.exit(1)
os.execv({ffmpeg!r}, [{ffmpeg!r}, *sys.argv[1:]])
""",
        encoding="utf-8",
    )
    wrapper.chmod(0o700)
    monkeypatch.setenv("PATH", str(tmp_path), prepend=os.pathsep)


def _running_process(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


def test_cancelling_a_join_during_encoding_stops_both_audio_processes(
    site_client: TestClient,
    site_services: tuple[Site, Services],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    if (tools := join_tools()) is None:
        pytest.skip("Synthetic concatenation requires FFmpeg and ffprobe.")
    _hold_audio_processes(tmp_path, tools[0], monkeypatch)
    site, _ = site_services
    result = site_client.post(
        _ready(site_client, site, "BV17x411w7KC"),
        json={"mode": "joined", "album": "Cancelled album", "parts": [1, 2]},
    )
    assert result.status_code == 200, result.text
    (album,) = result.json()
    job = JobId(album["job"]["id"])
    markers = tuple(tmp_path / name for name in ("encoder.pid", "decoder.pid"))
    site.wait_for(
        job,
        JobState.RUNNING,
        until=lambda _: all(path.is_file() and path.stat().st_size for path in markers),
    )
    process_ids = [int(path.read_text(encoding="utf-8")) for path in markers]

    cancelled = site_client.post(f"/api/jobs/{job}/cancel")

    assert cancelled.status_code == 200, cancelled.text
    site.wait_for(
        job, JobState.CANCELLED, until=lambda _: not any(map(_running_process, process_ids))
    )
    assert not (site.downloads.folder / f"{album['source_id']}.m4a").exists()


def test_album_queues_each_source_in_order_with_household_album_details(
    site_client: TestClient, site_services: tuple[Site, Services], units: sessionmaker[Session]
) -> None:
    site, _ = site_services
    path = _ready(site_client, site, "BV17x411w7KC")
    album = {"mode": "album", "album": "Studio Sessions", "artist": "Trio", "quality": "30216"}

    result = site_client.post(path, json=album)

    assert result.status_code == 200, result.text
    assert [row["part"] for row in result.json()] == [1, 2, 3]
    with units() as db:
        for number, row in enumerate(result.json(), 1):
            song = db.get_one(TrackRow, row["track_id"])
            job = db.get_one(JobRow, row["job"]["id"])
            assert (song.album, song.album_artist, song.artist) == ("Studio Sessions", "Trio", "")
            assert (song.title, song.track_number, song.kind) == (
                f"Mixtape {number}",
                number,
                "song",
            )
            assert (job.request["part"], job.request["quality"]) == (number, "30216")
    assert site_client.post(path, json=album).status_code == 404


def test_mixed_album_adds_nothing_and_quick_download_skips_existing_edits(
    site_client: TestClient, site_services: tuple[Site, Services], units: sessionmaker[Session]
) -> None:
    site, _ = site_services
    first = _ready(site_client, site, "BV17x411w7KC")
    assert site_client.post(first, json=CHOICE).status_code == 200
    path = _ready(site_client, site, "BV17x411w7KC")

    assert site_client.post(path, json={"mode": "album", "album": "Sessions"}).status_code == 409
    with units() as db:
        assert [(t.title, t.album) for t in db.scalars(select(TrackRow))] == [("Side B", "")]
    result = site_client.post(path, json={"mode": "download"})
    assert [row["part"] for row in result.json()] == [1, 3]
    with units() as db:
        assert len(db.scalars(select(JobRow).where(JobRow.kind == "download_source")).all()) == 3


def test_an_album_uses_only_the_selected_new_parts_in_video_order(
    site_client: TestClient, site_services: tuple[Site, Services], units: sessionmaker[Session]
) -> None:
    site, _ = site_services
    first = _ready(site_client, site, "BV17x411w7KC")
    assert site_client.post(first, json=CHOICE).status_code == 200
    path = _ready(site_client, site, "BV17x411w7KC")

    result = site_client.post(path, json={"mode": "album", "album": "Sessions", "parts": [3, 1]})

    assert result.status_code == 200, result.text
    assert [row["part"] for row in result.json()] == [1, 3]
    with units() as db:
        songs = db.scalars(select(TrackRow).order_by(TrackRow.id)).all()
        assert [(song.title, song.album, song.track_number) for song in songs] == [
            ("Side B", "", None),
            ("Mixtape 1", "Sessions", 1),
            ("Mixtape 3", "Sessions", 2),
        ]


def test_quick_download_refuses_unknown_parts_and_keeps_the_lookup_for_a_valid_subset(
    site_client: TestClient, site_services: tuple[Site, Services]
) -> None:
    site, _ = site_services
    path = _ready(site_client, site, "BV17x411w7KC")

    refused = site_client.post(path, json={"mode": "download", "parts": [2, 4]})
    result = site_client.post(path, json={"mode": "download", "parts": [2]})

    assert refused.status_code == 422
    assert result.status_code == 200, result.text
    assert [row["part"] for row in result.json()] == [2]
    assert site_client.get(path).status_code == 404


def test_quick_download_keeps_a_single_file_whole_without_an_artist_guess(
    site_client: TestClient, site_services: tuple[Site, Services], units: sessionmaker[Session]
) -> None:
    site, _ = site_services
    path = _ready(site_client, site, "BV1Xx41117Tz")
    site.online.online = False
    assert site_client.post(path, json={"mode": "download"}).status_code == 409
    site.online.online = True

    result = site_client.post(path, json={"mode": "download"})

    assert result.status_code == 200, result.text
    with units() as db:
        song = db.get_one(TrackRow, result.json()[0]["track_id"])
        assert song.artist == ""
        assert db.get_one(SplitOfferStateRow, song.id).kept_at is not None


def _assert_private(client: TestClient, job_id: JobId) -> None:
    path = f"{LOOKUPS}/{job_id}"
    assert client.get(LOOKUPS).json() == []
    assert client.get(path).status_code == 404
    assert client.delete(path).status_code == 404
    assert client.post(path, json=CHOICE).status_code == 404
    assert client.post(path, json={"mode": "download"}).status_code == 404
    assert client.get(f"/api/jobs/{job_id}").status_code == 404
    assert client.post(f"/api/jobs/{job_id}/cancel").status_code == 404
    assert client.post(f"/api/jobs/{job_id}/retry").status_code == 404
    assert job_id not in [j["id"] for j in client.get("/api/jobs").json()]


def test_a_saved_lookup_adds_only_the_parts_confirmed_by_its_owner(
    site_client: TestClient, site_services: tuple[Site, Services], units: sessionmaker[Session]
) -> None:
    site, _ = site_services
    add_bob(site_client)
    sign_in(site_client, "bob")
    response = site_client.post(
        LOOKUPS,
        json={"link": "https://www.bilibili.com/video/BV17x411w7KC?p=2&token=private#sharing"},
    )
    assert response.status_code == 202
    job_id = JobId(response.json()["id"])
    path = f"{LOOKUPS}/{job_id}"
    site.wait_for(job_id, JobState.SUCCEEDED)

    with units() as db:
        job = db.get_one(JobRow, job_id)
        assert job.request["link"] == "https://www.bilibili.com/video/BV17x411w7KC?p=2"
        assert db.scalars(select(TrackRow)).all() == []
    sign_in(site_client, "alice")
    _assert_private(site_client, job_id)
    other = site_client.post(
        LOOKUPS, json={"link": "https://www.bilibili.com/video/BV17x411w7KC?p=2"}
    )
    assert other.status_code == 202
    assert other.json()["id"] != job_id

    sign_in(site_client, "bob")
    assert [saved["id"] for saved in site_client.get(LOOKUPS).json()] == [job_id]
    assert len(site_client.get(path).json()["result"]["parts"]) == 3
    assert site_client.post(path, json={"parts": []}).status_code == 422
    site.online.online = False
    assert site_client.post(path, json=CHOICE).status_code == 409
    assert site_client.get(path).json()["result"]["readable"]
    site.online.online = True
    added = site_client.post(path, json=CHOICE)
    assert added.status_code == 200
    assert [part["part"] for part in added.json()] == [2]
    assert site_client.get(LOOKUPS).json() == []
    assert site_client.post(path, json=CHOICE).status_code == 404
    sign_in(site_client, "alice")
    other_id = JobId(other.json()["id"])
    site.wait_for(other_id, JobState.SUCCEEDED)
    parts = site_client.get(f"{LOOKUPS}/{other_id}").json()["result"]["parts"]
    assert parts[1]["track_id"] == added.json()[0]["track_id"]
    duplicate = site_client.post(f"{LOOKUPS}/{other_id}", json=CHOICE)
    assert duplicate.json()[0]["track_id"] == parts[1]["track_id"]


def test_an_unreadable_video_keeps_manual_entry_and_can_be_dismissed(
    site_client: TestClient, site_services: tuple[Site, Services]
) -> None:
    site, _ = site_services
    response = site_client.post(LOOKUPS, json={"link": "https://www.bilibili.com/video/BVdown?p=3"})
    assert response.status_code == 202
    job_id = JobId(response.json()["id"])
    site.wait_for(job_id, JobState.SUCCEEDED)

    path = f"{LOOKUPS}/{job_id}"
    result = site_client.get(path).json()["result"]
    assert (result["readable"], result["reason"], result["parts"][0]["part"]) == (
        False,
        "network",
        3,
    )
    assert site_client.post(path, json={"mode": "download"}).status_code == 422
    assert site_client.delete(path).status_code == 204
    assert site_client.get(LOOKUPS).json() == []
    assert site_client.post(path, json=CHOICE).status_code == 404


def test_no_lookup_operation_can_be_used_signed_out(client: TestClient) -> None:
    assert client.post(LOOKUPS, json={"link": "av170001"}).status_code == 401
    assert client.get(LOOKUPS).status_code == 401
    assert client.get(f"{LOOKUPS}/1").status_code == 401
    assert client.delete(f"{LOOKUPS}/1").status_code == 401
    assert client.post(f"{LOOKUPS}/1", json=CHOICE).status_code == 401
