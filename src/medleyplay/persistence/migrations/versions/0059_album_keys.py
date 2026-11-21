"""Key each album as the page groups it, keep its searches per finder, and its dismissed covers.

An album was keyed by its name and artist NFKC-folded and case-folded; the page groups
them by NFKC, lower case, and katakana as hiragana, so the two disagreed on kana and on
*ß*. Searches and links rekeyed alike merge, keeping the latest. A search is kept per
finder, `musicbrainz` for those there are, and covers dismissed for an album get their
own table.

Revision ID: 0059
Revises: 0058
Create Date: 2026-11-21 12:00:00.000000
"""

import hashlib
import unicodedata
from collections.abc import Callable, Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0059"
down_revision: str | None = "0058"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_KATAKANA = str.maketrans({code: code - 0x60 for code in range(ord("ァ"), ord("ヶ") + 1)})


def _as_grouped(text: str) -> str:
    return unicodedata.normalize("NFKC", text).lower().translate(_KATAKANA).strip()


def _case_folded(text: str) -> str:
    return unicodedata.normalize("NFKC", text.strip()).casefold()


def _key(fold: Callable[[str], str], album: str, artist: str) -> str:
    return hashlib.sha256(f"{fold(artist)}\n{fold(album)}".encode()).hexdigest()


_SEARCHES = sa.table(
    "album_cover_search",
    sa.column("key", sa.String),
    sa.column("album", sa.String),
    sa.column("artist", sa.String),
    sa.column("found_at", sa.DateTime),
)
_LINKS = sa.table(
    "image_links",
    sa.column("subject", sa.String),
    sa.column("key", sa.String),
    sa.column("name", sa.String),
    sa.column("artist", sa.String),
    sa.column("asked_at", sa.DateTime),
)


def _rekey(
    table: sa.TableClause,
    name: sa.ColumnClause[str],
    at: sa.ColumnClause[object],
    where: sa.ColumnElement[bool],
    fold: Callable[[str], str],
) -> None:
    """Key each row of `table` by its `name` and `artist` under `fold`; the latest by `at` stays."""
    connection = op.get_bind()
    key = table.c.key
    rows = connection.execute(sa.select(key, name, table.c.artist).where(where).order_by(at)).all()
    kept: dict[str, str] = {}
    for old, album, artist in rows:
        kept[_key(fold, album, artist)] = old
    keeping = set(kept.values())
    for old, _, _ in rows:
        if old not in keeping:
            connection.execute(sa.delete(table).where(where, key == old))
    for new, old in kept.items():
        connection.execute(sa.update(table).where(where, key == old).values(key=new))


def upgrade() -> None:
    """Apply this revision."""
    _rekey(_SEARCHES, _SEARCHES.c.album, _SEARCHES.c.found_at, sa.true(), _as_grouped)
    _rekey(_LINKS, _LINKS.c.name, _LINKS.c.asked_at, _LINKS.c.subject == "album", _as_grouped)
    with op.batch_alter_table("album_cover_search", recreate="always") as batch:
        batch.add_column(
            sa.Column("finder", sa.String(length=32), server_default="musicbrainz", nullable=False)
        )
        batch.drop_constraint("pk_album_cover_search", type_="primary")
        batch.create_primary_key("pk_album_cover_search", ["key", "finder"])
    op.create_table(
        "album_cover_dismissal",
        sa.Column("key", sa.String(length=64), nullable=False),
        sa.Column("cover", sa.String(length=64), nullable=False),
        sa.PrimaryKeyConstraint("key", "cover", name=op.f("pk_album_cover_dismissal")),
    )


def downgrade() -> None:
    """Revert this revision."""
    op.drop_table("album_cover_dismissal")
    op.execute("DELETE FROM album_cover_search WHERE finder != 'musicbrainz'")
    with op.batch_alter_table("album_cover_search", recreate="always") as batch:
        batch.drop_constraint("pk_album_cover_search", type_="primary")
        batch.drop_column("finder")
        batch.create_primary_key("pk_album_cover_search", ["key"])
    _rekey(_SEARCHES, _SEARCHES.c.album, _SEARCHES.c.found_at, sa.true(), _case_folded)
    _rekey(_LINKS, _LINKS.c.name, _LINKS.c.asked_at, _LINKS.c.subject == "album", _case_folded)
