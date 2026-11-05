"""The database: migrations match the schema, and every connection is configured."""

import json
import uuid
from datetime import datetime
from pathlib import Path

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import Connection, Engine, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.persistence.database import (
    MIGRATIONS,
    MigrationError,
    database_url,
    make_engine,
    migrate,
)
from medleyplay.persistence.schema import Base, UtcDateTime


def test_the_migrations_build_exactly_the_schema_the_code_declares(tmp_path: Path) -> None:
    engine = make_engine(database_url(tmp_path))
    migrate(engine)

    with engine.connect() as connection:
        differences = compare_metadata(MigrationContext.configure(connection), Base.metadata)
    engine.dispose()

    assert differences == []


def test_migrating_a_current_database_again_changes_nothing(
    units: sessionmaker[Session],
) -> None:
    engine = units.kw["bind"]

    migrate(engine)

    with engine.connect() as connection:
        assert connection.scalar(text("SELECT version_num FROM alembic_version")) == _head()


def _head() -> str | None:
    config = Config()
    config.set_main_option("script_location", MIGRATIONS)
    return ScriptDirectory.from_config(config).get_current_head()


@pytest.mark.parametrize(
    ("pragma", "expected"), [("foreign_keys", 1), ("busy_timeout", 5000), ("journal_mode", "wal")]
)
def test_every_connection_to_a_file_database_is_configured(
    units: sessionmaker[Session], pragma: str, expected: object
) -> None:
    with units() as db:
        assert db.scalar(text(f"PRAGMA {pragma}")) == expected


def test_an_in_memory_database_keeps_its_default_journal() -> None:
    engine = make_engine("sqlite://")

    with engine.connect() as connection:
        assert connection.scalar(text("PRAGMA journal_mode")) == "memory"
    engine.dispose()


def test_a_naive_datetime_is_refused_rather_than_guessed() -> None:
    with pytest.raises(ValueError, match="naive"):
        UtcDateTime().process_bind_param(datetime(2026, 1, 1), make_engine("sqlite://").dialect)  # noqa: DTZ001 -- the naive value is the input under test


def test_migrating_keeps_an_accounts_oldest_smart_playlist_of_favorites_as_its_favorites(
    tmp_path: Path,
) -> None:
    engine = make_engine(database_url(tmp_path))
    _migrate_to(engine, "0008")
    favorites = {"version": 1, "match": "all", "conditions": [_FAVORITE]}
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO account (id, username, display_name, password_hash, role, created_at)"
                " VALUES (1, 'alice', 'Alice', 'x', 'admin', '2026-10-01 00:00:00.000000')"
            )
        )
        for name, rules, created in [
            ("Hearts", favorites, "2026-10-02"),
            ("Favorites", favorites, "2026-10-03"),
            (
                "Not favorites",
                {**favorites, "conditions": [{**_FAVORITE, "negate": True}]},
                "2026-10-01",
            ),
            ("Road trip", None, "2026-10-01"),
        ]:
            connection.execute(
                text(
                    "INSERT INTO playlist (id, account_id, name, rules, keep_downloaded,"
                    " created_at, updated_at) VALUES (:id, 1, :name, :rules, 0, :at, :at)"
                ),
                {
                    "id": uuid.uuid4().hex,
                    "name": name,
                    "rules": None if rules is None else json.dumps(rules),
                    "at": f"{created} 00:00:00.000000",
                },
            )

    migrate(engine)

    with engine.connect() as connection:
        marked = connection.execute(
            text("SELECT name, builtin FROM playlist WHERE builtin IS NOT NULL")
        ).all()
    engine.dispose()
    assert marked == [("Hearts", "favorites")]


def test_migrating_records_each_tracks_values_with_the_origin_they_most_likely_had(
    tmp_path: Path,
) -> None:
    engine = make_engine(database_url(tmp_path))
    _migrate_to(engine, "0011")
    with engine.begin() as connection:
        for track_id, title, artist, kind, locator in [
            (1, "Night Drive", "Blue Room", "library", "1/Albums/01 Intro.flac"),
            (2, "BV1dm4y1s7ak", "", "library", "2/BV1dm4y1s7ak.m4a"),
            (3, "Mixtape", "Blue Room", "bilibili", "BV17x411w7KC/p1"),
        ]:
            connection.execute(
                text(
                    "INSERT INTO track (id, title, artist, album, album_artist, added_at)"
                    " VALUES (:id, :title, :artist, '', '', '2026-10-01 00:00:00.000000')"
                ),
                {"id": track_id, "title": title, "artist": artist},
            )
            connection.execute(
                text(
                    "INSERT INTO source (track_id, kind, locator, state, details)"
                    " VALUES (:id, :kind, :locator, 'ok', '{}')"
                ),
                {"id": track_id, "kind": kind, "locator": locator},
            )

    migrate(engine)

    with engine.connect() as connection:
        values = connection.execute(
            text("SELECT track_id, field, origin, value FROM track_value ORDER BY 1, 2, 3")
        ).all()
    engine.dispose()
    assert [
        (track, field, origin, json.loads(value)) for track, field, origin, value in values
    ] == [
        (1, "artist", "files", "Blue Room"),
        (1, "title", "file_name", "01 Intro"),
        (1, "title", "files", "Night Drive"),
        (2, "title", "file_name", "BV1dm4y1s7ak"),
        (3, "artist", "video", "Blue Room"),
        (3, "title", "video", "Mixtape"),
    ]


def test_a_migration_refused_for_broken_references_leaves_the_database_as_it_was(
    tmp_path: Path,
) -> None:
    engine = make_engine(database_url(tmp_path))
    _migrate_to(engine, "0011")
    with engine.connect() as connection:
        # A Source of a Track that is gone: only a database edited by hand could hold one.
        connection.exec_driver_sql("PRAGMA foreign_keys = OFF")
        connection.execute(
            text(
                "INSERT INTO source (track_id, kind, locator, state, details)"
                " VALUES (99, 'library', '1/Gone.flac', 'ok', '{}')"
            )
        )
        connection.commit()

    with pytest.raises(MigrationError, match="1 broken reference"):
        migrate(engine)

    with engine.connect() as connection:
        version = connection.scalar(text("SELECT version_num FROM alembic_version"))
        columns = {row.name for row in connection.execute(text("PRAGMA table_info(track)"))}
    engine.dispose()
    assert (version, "track_number" in columns) == ("0011", False)


def test_undoing_the_covers_forgets_every_cover_value(tmp_path: Path) -> None:
    engine = make_engine(database_url(tmp_path))
    migrate(engine)
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO track (id, title, artist, album, album_artist, genre, added_at)"
                " VALUES (1, 'Bremen', '', '', '', '', '2026-10-01 00:00:00.000000')"
            )
        )
        for field, value in [("title", '"Bremen"'), ("cover", f'"{"0" * 64}"')]:
            connection.execute(
                text(
                    "INSERT INTO track_value (track_id, origin, field, value, recorded_at)"
                    " VALUES (1, 'household', :field, :value, '2026-10-01 00:00:00.000000')"
                ),
                {"field": field, "value": value},
            )

    _migrate_to(engine, "0014", down=True)

    with engine.connect() as connection:
        fields = connection.scalars(text("SELECT field FROM track_value")).all()
    engine.dispose()
    assert fields == ["title"]


def test_the_proxy_table_keeps_only_a_scheme_and_port_the_core_takes(
    units: sessionmaker[Session],
) -> None:
    insert = text(
        "INSERT INTO proxy (site, scheme, host, port, has_login, saved_at)"
        " VALUES ('bilibili', :scheme, '127.0.0.1', :port, 0, '2026-11-04 00:00:00.000000')"
    )

    for scheme, port in [("socks5", 7890), ("http", 0), ("http", 65536)]:
        with pytest.raises(IntegrityError), units.begin() as db:
            db.execute(insert, {"scheme": scheme, "port": port})

    with units.begin() as db:
        db.execute(insert, {"scheme": "socks5h", "port": 7890})


def test_undoing_the_proxy_migration_drops_the_table(tmp_path: Path) -> None:
    engine = make_engine(database_url(tmp_path))
    migrate(engine)

    _migrate_to(engine, "0016", down=True)

    with engine.connect() as connection:
        tables = connection.scalars(text("SELECT name FROM sqlite_master WHERE type = 'table'"))
        assert "proxy" not in tables.all()
    engine.dispose()


_ADD_VIDEO_TEXT = text(
    "INSERT INTO video_text (track_id, title, description, chapters, came_from, recorded_at)"
    " VALUES (1, 'Melt', '', '[]', :came_from, '2026-11-05 00:00:00.000000')"
)


def test_a_videos_text_may_have_come_from_the_household_a_file_or_the_site_and_nowhere_else(
    units: sessionmaker[Session],
) -> None:
    with units.begin() as db:
        _add_track(db.connection(), "Melt", track_id=1)

    for came_from in ("household", "file", "site"):
        with units.begin() as db:
            db.execute(text("DELETE FROM video_text"))
            db.execute(_ADD_VIDEO_TEXT, {"came_from": came_from})
    with pytest.raises(IntegrityError), units.begin() as db:
        db.execute(_ADD_VIDEO_TEXT, {"came_from": "friend"})


def test_undoing_the_enrichers_migration_makes_text_read_from_the_site_the_households(
    tmp_path: Path,
) -> None:
    engine = make_engine(database_url(tmp_path))
    migrate(engine)
    with engine.begin() as connection:
        _add_track(connection, "Melt", track_id=1)
        connection.execute(_ADD_VIDEO_TEXT, {"came_from": "site"})
        connection.execute(
            text(
                "INSERT INTO enricher_ask (enricher, subject, asked_at)"
                " VALUES ('bilibili-details', 'BV1', '2026-11-05 00:00:00.000000')"
            )
        )

    _migrate_to(engine, "0017", down=True)

    with engine.connect() as connection:
        came_from = connection.scalars(text("SELECT came_from FROM video_text")).all()
        tables = connection.scalars(text("SELECT name FROM sqlite_master WHERE type = 'table'"))
        assert (came_from, {"video_ask", "enricher_ask", "enricher_stop"} & set(tables.all())) == (
            ["household"],
            set(),
        )
    engine.dispose()


_ASK = {"enricher": "bilibili-details", "key": "BV1dm4y1s7ak", "at": "2026-11-05 00:00:00.000000"}


def test_migrating_keeps_every_video_asked_as_a_subject_asked(tmp_path: Path) -> None:
    engine = make_engine(database_url(tmp_path))
    _migrate_to(engine, "0018")
    with engine.begin() as connection:
        connection.execute(
            text("INSERT INTO video_ask (enricher, video, asked_at) VALUES (:enricher, :key, :at)"),
            _ASK,
        )

    migrate(engine)

    with engine.connect() as connection:
        asked = connection.execute(text("SELECT enricher, subject FROM enricher_ask")).all()
        tables = connection.scalars(text("SELECT name FROM sqlite_master WHERE type = 'table'"))
        assert ([tuple(row) for row in asked], "video_ask" in tables.all()) == (
            [("bilibili-details", "BV1dm4y1s7ak")],
            False,
        )
    engine.dispose()


def test_undoing_the_asks_migration_keeps_every_subject_asked_as_a_video_asked(
    tmp_path: Path,
) -> None:
    engine = make_engine(database_url(tmp_path))
    migrate(engine)
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO enricher_ask (enricher, subject, asked_at)"
                " VALUES (:enricher, :key, :at)"
            ),
            _ASK,
        )

    _migrate_to(engine, "0018", down=True)

    with engine.connect() as connection:
        asked = connection.execute(text("SELECT enricher, video FROM video_ask")).all()
        assert [tuple(row) for row in asked] == [("bilibili-details", "BV1dm4y1s7ak")]
    engine.dispose()


def test_a_removed_tracks_id_is_never_given_to_another(tmp_path: Path) -> None:
    engine = make_engine(database_url(tmp_path))
    migrate(engine)
    with engine.begin() as connection:
        _add_track(connection, "Intro")
        removed = _add_track(connection, "Outro")
        connection.execute(text("DELETE FROM track WHERE id = :id"), {"id": removed})

    with engine.begin() as connection:
        added = _add_track(connection, "Night Drive")
    engine.dispose()

    assert added > removed


def test_keeping_track_ids_unique_keeps_every_track_and_the_rows_naming_it(
    tmp_path: Path,
) -> None:
    engine = make_engine(database_url(tmp_path))
    _migrate_to(engine, "0015")
    with engine.begin() as connection:
        _add_track(connection, "Intro", track_id=1)
        _add_track(connection, "Outro", track_id=2)
        connection.execute(
            text(
                "INSERT INTO track_value (track_id, origin, field, value, recorded_at)"
                " VALUES (1, 'household', 'title', '\"Intro\"', '2026-10-01 00:00:00.000000')"
            )
        )

    migrate(engine)
    with engine.begin() as connection:
        connection.execute(text("DELETE FROM track WHERE id = 2"))
        added = _add_track(connection, "Night Drive")
        tracks = connection.execute(text("SELECT id, title FROM track ORDER BY id")).all()
        values = connection.execute(text("SELECT track_id, field FROM track_value")).all()
    engine.dispose()

    assert added == 3
    assert [tuple(row) for row in tracks] == [(1, "Intro"), (3, "Night Drive")]
    assert [tuple(row) for row in values] == [(1, "title")]


def _add_track(connection: Connection, title: str, *, track_id: int | None = None) -> int:
    """Add a Track called `title` as SQL would, with `track_id` or the next id; return its id."""
    added = connection.execute(
        text(
            "INSERT INTO track (id, title, artist, album, album_artist, genre, added_at)"
            " VALUES (:id, :title, '', '', '', '', '2026-10-01 00:00:00.000000') RETURNING id"
        ),
        {"id": track_id, "title": title},
    ).scalar_one()
    return int(added)


_FAVORITE = {"field": "favorite", "op": "is", "value": True}


def _migrate_to(engine: Engine, revision: str, *, down: bool = False) -> None:
    config = Config()
    config.set_main_option("script_location", MIGRATIONS)
    with engine.connect() as connection:
        # As `migrate` does: rebuilding a table must not cascade into the rows that name it.
        connection.exec_driver_sql("PRAGMA foreign_keys = OFF")
        connection.commit()
        with connection.begin():
            config.attributes["connection"] = connection
            (command.downgrade if down else command.upgrade)(config, revision)
