"""Keep the artists a site knows by the Library's names, and the names the household linked.

Revision ID: 0034
Revises: 0033
Create Date: 2026-11-15 20:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import medleyplay.persistence.schema

revision: str = "0034"
down_revision: str | None = "0033"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Apply this revision."""
    op.create_table(
        "artist",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("sort_name", sa.Text(), nullable=False),
        sa.Column("disambiguation", sa.Text(), nullable=False),
        sa.Column("country", sa.String(length=8), nullable=False),
        sa.Column("found_at", medleyplay.persistence.schema.UtcDateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_artist")),
    )
    op.create_table(
        "artist_alias",
        sa.Column("artist_id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=512), nullable=False),
        sa.Column("key", sa.String(length=512), nullable=False),
        sa.Column("locale", sa.String(length=16), nullable=True),
        sa.Column("primary", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(
            ["artist_id"],
            ["artist.id"],
            name=op.f("fk_artist_alias_artist_id_artist"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("artist_id", "name", name=op.f("pk_artist_alias")),
    )
    op.create_index("ix_artist_alias_key", "artist_alias", ["key"])
    op.create_table(
        "artist_search",
        sa.Column("key", sa.String(length=512), nullable=False),
        sa.Column("name", sa.String(length=512), nullable=False),
        sa.Column("found", sa.JSON(), nullable=False),
        sa.Column("looked_at", medleyplay.persistence.schema.UtcDateTime(), nullable=False),
        sa.PrimaryKeyConstraint("key", name=op.f("pk_artist_search")),
    )
    op.create_table(
        "artist_link",
        sa.Column("key", sa.String(length=512), nullable=False),
        sa.Column("name", sa.String(length=512), nullable=False),
        sa.Column("artist_id", sa.String(length=64), nullable=True),
        sa.Column("linked_at", medleyplay.persistence.schema.UtcDateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["artist_id"],
            ["artist.id"],
            name=op.f("fk_artist_link_artist_id_artist"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("key", name=op.f("pk_artist_link")),
    )


def downgrade() -> None:
    """Revert this revision."""
    op.drop_table("artist_link")
    op.drop_table("artist_search")
    op.drop_index("ix_artist_alias_key", table_name="artist_alias")
    op.drop_table("artist_alias")
    op.drop_table("artist")
