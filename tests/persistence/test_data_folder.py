"""Moving the data folder: a checked copy, then the old folder deleted."""

import json
import shutil
import sqlite3
from pathlib import Path

import pytest

from medleyplay.persistence.data_folder import DataMoveError, move_data_folder
from medleyplay.persistence.database import database_path, database_url, make_engine, migrate


def _data_folder(folder: Path) -> Path:
    """A data folder as a server leaves it: its database, a cover, a download, and its lock.

    ```text
    folder/
      medleyplay.sqlite3
      covers/ab12.jpg
      downloads/529.m4a
      server.lock
    ```
    """
    folder.mkdir(parents=True)
    engine = make_engine(database_url(folder))
    migrate(engine)
    engine.dispose()
    (folder / "covers").mkdir()
    (folder / "covers" / "ab12.jpg").write_bytes(b"\xff\xd8 a cover")
    (folder / "downloads").mkdir()
    (folder / "downloads" / "529.m4a").write_bytes(b"a song" * 1000)
    (folder / "server.lock").touch()
    return folder


def _queue_thumbnails_job(folder: Path, covers: Path | None = None) -> None:
    """Queue a Job in `folder`'s database to make thumbnails of the covers in `covers`.

    ```json
    {"covers_folder": "<folder>/covers", "names": ["ab12"]}
    ```

    By default the covers are `folder`'s own, so the Job names `folder` whole.
    """
    covers_folder = folder / "covers" if covers is None else covers
    request = json.dumps({"covers_folder": str(covers_folder), "names": ["ab12"]})
    with sqlite3.connect(database_path(folder)) as db:
        db.execute(
            "INSERT INTO job (kind, target, state, request, attempts, interruptions,"
            " failure_message, created_at)"
            " VALUES ('make_thumbnails', 'thumbnails', 'queued', ?, 0, 0, '', '2026-11-21')",
            (request,),
        )
    db.close()


def _covers_folder_of_the_job(folder: Path) -> str:
    with sqlite3.connect(database_path(folder)) as db:
        [(request,)] = db.execute("SELECT request FROM job").fetchall()
    db.close()
    return str(json.loads(request)["covers_folder"])


def _files_in(folder: Path) -> dict[str, bytes]:
    return {
        str(path.relative_to(folder)): path.read_bytes()
        for path in sorted(folder.rglob("*"))
        if path.is_file() and not path.name.startswith("medleyplay.sqlite3")
    }


def test_a_move_copies_every_file_then_deletes_the_old_folder(tmp_path: Path) -> None:
    source = _data_folder(tmp_path / "Application Support" / "medleyplay")
    before = _files_in(source)
    target = tmp_path / "Music" / "medleyplay"

    moved = move_data_folder(source, target, leave={"server.lock"})

    assert not source.exists()
    assert _files_in(target) == {k: v for k, v in before.items() if k != "server.lock"}
    with sqlite3.connect(database_path(target)) as db:
        assert db.execute("PRAGMA integrity_check").fetchone() == ("ok",)
    db.close()
    assert moved.files >= 3
    assert moved.size > 6000


def test_a_move_rewrites_the_old_folder_in_jobs_that_name_it(tmp_path: Path) -> None:
    source = _data_folder(tmp_path / "old")
    _queue_thumbnails_job(source)
    target = tmp_path / "new"

    move_data_folder(source, target)

    assert _covers_folder_of_the_job(target) == str(target / "covers")


def test_a_move_leaves_jobs_naming_a_folder_whose_name_only_starts_alike(
    tmp_path: Path,
) -> None:
    source = _data_folder(tmp_path / "old")
    _queue_thumbnails_job(source, covers=tmp_path / "older" / "covers")

    move_data_folder(source, tmp_path / "new")

    assert _covers_folder_of_the_job(tmp_path / "new") == str(tmp_path / "older" / "covers")


def test_a_move_into_an_empty_folder_that_exists_is_allowed(tmp_path: Path) -> None:
    source = _data_folder(tmp_path / "old")
    target = tmp_path / "new"
    target.mkdir()

    move_data_folder(source, target)

    assert database_path(target).exists()


def test_a_move_is_refused_into_a_folder_that_already_holds_files(tmp_path: Path) -> None:
    source = _data_folder(tmp_path / "old")
    target = tmp_path / "new"
    target.mkdir()
    (target / "mine.txt").write_text("not medleyplay's")

    with pytest.raises(DataMoveError, match="already holds files"):
        move_data_folder(source, target)

    assert database_path(source).exists()
    assert sorted(path.name for path in target.iterdir()) == ["mine.txt"]


def test_a_move_is_refused_from_a_folder_with_no_database(tmp_path: Path) -> None:
    source = tmp_path / "old"
    source.mkdir()

    with pytest.raises(DataMoveError, match="No medleyplay database"):
        move_data_folder(source, tmp_path / "new")

    assert not (tmp_path / "new").exists()


@pytest.mark.parametrize("inside", ["", "nested"])
def test_a_move_is_refused_into_the_folder_itself_or_one_inside_it(
    tmp_path: Path, inside: str
) -> None:
    source = _data_folder(tmp_path / "old")

    with pytest.raises(DataMoveError, match="inside"):
        move_data_folder(source, source / inside)

    assert database_path(source).exists()


def test_a_copy_that_does_not_match_leaves_everything_as_it_was(tmp_path: Path) -> None:
    source = _data_folder(tmp_path / "old")
    target = tmp_path / "new"

    def copy_cut_short(src: str, dst: str) -> str:
        shutil.copy2(src, dst)
        if dst.endswith(".m4a"):
            Path(dst).write_bytes(b"cut")
        return dst

    with pytest.raises(DataMoveError, match=r"downloads/529\.m4a"):
        move_data_folder(source, target, copy_file=copy_cut_short)

    assert (source / "downloads" / "529.m4a").read_bytes() == b"a song" * 1000
    assert not target.exists()
    assert [path.name for path in tmp_path.iterdir()] == ["old"]
