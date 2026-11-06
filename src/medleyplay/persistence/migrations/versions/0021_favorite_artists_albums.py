"""Keep the artists and albums each Account favorited.

Revision ID: 0021
Revises: 0020
Create Date: 2026-11-06 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0021"
down_revision: str | None = "0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Apply this revision."""
    op.create_table(
        "favorite_artist",
        sa.Column("account_id", sa.Integer(), nullable=False),
        sa.Column("key", sa.String(length=512), nullable=False),
        sa.Column("name", sa.String(length=512), nullable=False),
        sa.ForeignKeyConstraint(
            ["account_id"],
            ["account.id"],
            name=op.f("fk_favorite_artist_account_id_account"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("account_id", "key", name=op.f("pk_favorite_artist")),
    )
    op.create_table(
        "favorite_album",
        sa.Column("account_id", sa.Integer(), nullable=False),
        sa.Column("artist_key", sa.String(length=512), nullable=False),
        sa.Column("album_key", sa.String(length=512), nullable=False),
        sa.Column("artist", sa.String(length=512), nullable=False),
        sa.Column("album", sa.String(length=512), nullable=False),
        sa.ForeignKeyConstraint(
            ["account_id"],
            ["account.id"],
            name=op.f("fk_favorite_album_account_id_account"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "account_id", "artist_key", "album_key", name=op.f("pk_favorite_album")
        ),
    )


def downgrade() -> None:
    """Revert this revision, forgetting the favorite artists and albums."""
    op.drop_table("favorite_album")
    op.drop_table("favorite_artist")
