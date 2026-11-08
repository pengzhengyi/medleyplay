"""Keep the albums each Account rated or reviewed on Rate Your Music, as imported.

Revision ID: 0029
Revises: 0028
Create Date: 2026-11-08 20:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0029"
down_revision: str | None = "0028"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Apply this revision; no Account has an album rating until it imports one."""
    op.create_table(
        "album_rating",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("account_id", sa.Integer(), nullable=False),
        sa.Column("source_id", sa.Text(), nullable=False),
        sa.Column("artist", sa.Text(), nullable=False),
        sa.Column("artist_localized", sa.Text(), nullable=False),
        sa.Column("album", sa.Text(), nullable=False),
        sa.Column("artist_key", sa.Text(), nullable=False),
        sa.Column("localized_key", sa.Text(), nullable=False),
        sa.Column("album_key", sa.Text(), nullable=False),
        sa.Column("plain_key", sa.Text(), nullable=False),
        sa.Column("stars", sa.Integer(), nullable=True),
        sa.Column("note", sa.Text(), nullable=False),
        sa.CheckConstraint(
            "stars IS NULL OR stars BETWEEN 1 AND 5", name=op.f("ck_album_rating_stars")
        ),
        sa.ForeignKeyConstraint(
            ["account_id"],
            ["account.id"],
            name=op.f("fk_album_rating_account_id_account"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_album_rating")),
    )
    op.create_index(
        "ix_album_rating_account_id_album_key", "album_rating", ["account_id", "album_key"]
    )


def downgrade() -> None:
    """Revert this revision, forgetting every imported album rating."""
    op.drop_index("ix_album_rating_account_id_album_key", table_name="album_rating")
    op.drop_table("album_rating")
