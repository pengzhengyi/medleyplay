"""The database revision: it changes once rows change and their connection returns."""

from collections.abc import Callable, Iterator
from pathlib import Path

import pytest
from sqlalchemy import Engine, String, delete, insert, select, text, update
from sqlalchemy.dialects.sqlite import insert as upsert
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from medleyplay.persistence.database import database_url, make_engine, make_sessionmaker
from medleyplay.persistence.revision import DatabaseRevision


class _Base(DeclarativeBase):
    pass


class _NoteRow(_Base):
    """A note: the one table these tests write, so they need no schema of the app's."""

    __tablename__ = "note"

    id: Mapped[int] = mapped_column(primary_key=True)
    body: Mapped[str] = mapped_column(String(64))


@pytest.fixture
def engine(tmp_path: Path) -> Iterator[Engine]:
    engine = make_engine(database_url(tmp_path))
    _Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture
def units(engine: Engine) -> sessionmaker[Session]:
    return make_sessionmaker(engine)


@pytest.fixture
def revision(engine: Engine, units: sessionmaker[Session]) -> DatabaseRevision:
    """Return a revision watching a database that holds one note, `1: "first"`."""
    with units.begin() as db:
        db.add(_NoteRow(id=1, body="first"))
    watched = DatabaseRevision()
    watched.watch(engine)
    return watched


Write = Callable[[Session], object]


def _orm_insert(db: Session) -> None:
    db.add(_NoteRow(id=2, body="second"))


def _orm_update(db: Session) -> None:
    note = db.get(_NoteRow, 1)
    assert note is not None
    note.body = "changed"


def _orm_delete(db: Session) -> None:
    note = db.get(_NoteRow, 1)
    assert note is not None
    db.delete(note)


def _core_update(db: Session) -> object:
    return db.execute(update(_NoteRow).where(_NoteRow.id == 1).values(body="changed"))


def _core_delete(db: Session) -> object:
    return db.execute(delete(_NoteRow).where(_NoteRow.id == 1))


def _text_insert(db: Session) -> object:
    return db.execute(text("INSERT INTO note (id, body) VALUES (2, 'second')"))


def _insert_or_update(db: Session) -> object:
    statement = upsert(_NoteRow).values(id=1, body="changed")
    return db.execute(
        statement.on_conflict_do_update(index_elements=[_NoteRow.id], set_={"body": "changed"})
    )


def _batch_insert(db: Session) -> object:
    return db.execute(insert(_NoteRow), [{"id": 2, "body": "b"}, {"id": 3, "body": "c"}])


@pytest.mark.parametrize(
    "write",
    [
        _orm_insert,
        _orm_update,
        _orm_delete,
        _core_update,
        _core_delete,
        _text_insert,
        _insert_or_update,
        _batch_insert,
    ],
)
def test_a_write_that_changes_rows_changes_the_revision(
    units: sessionmaker[Session], revision: DatabaseRevision, write: Write
) -> None:
    before = revision.value

    with units.begin() as db:
        write(db)

    assert revision.value > before


def _select(db: Session) -> object:
    return db.scalars(select(_NoteRow)).all()


def _pragma(db: Session) -> object:
    return db.execute(text("PRAGMA busy_timeout")).all()


def _update_matching_nothing(db: Session) -> object:
    return db.execute(update(_NoteRow).where(_NoteRow.id == 99).values(body="changed"))


def _delete_matching_nothing(db: Session) -> object:
    return db.execute(delete(_NoteRow).where(_NoteRow.body == "absent"))


@pytest.mark.parametrize(
    "read",
    [_select, _pragma, _update_matching_nothing, _delete_matching_nothing],
)
def test_a_unit_that_changes_no_rows_leaves_the_revision_alone(
    units: sessionmaker[Session], revision: DatabaseRevision, read: Write
) -> None:
    before = revision.value

    with units.begin() as db:
        read(db)

    assert revision.value == before


def test_the_revision_changes_when_the_connection_returns_not_when_the_statement_runs(
    units: sessionmaker[Session], revision: DatabaseRevision
) -> None:
    before = revision.value

    with units.begin() as db:
        _orm_insert(db)
        db.flush()
        during = revision.value

    assert during == before
    assert revision.value > before


def test_a_unit_rolled_back_after_changing_rows_changes_the_revision(
    units: sessionmaker[Session], revision: DatabaseRevision
) -> None:
    before = revision.value

    with units() as db:
        _core_update(db)
        db.rollback()

    assert revision.value > before


def test_an_invalidated_connection_changes_the_revision(
    engine: Engine, revision: DatabaseRevision
) -> None:
    before = revision.value

    with engine.connect() as connection:
        connection.invalidate()

    assert revision.value > before


def test_each_revision_starts_with_a_mark_of_its_own() -> None:
    first, second = DatabaseRevision(), DatabaseRevision()

    assert first.mark
    assert first.mark != second.mark
