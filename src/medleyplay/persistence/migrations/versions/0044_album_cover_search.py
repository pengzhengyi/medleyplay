"""Keep what a site last answered for an album: the covers of its releases, and an AI's pick.

Revision ID: 0044
Revises: 0043
Create Date: 2026-11-16 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import medleyplay.persistence.schema

revision: str = "0044"
down_revision: str | None = "0043"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Apply this revision."""
    op.create_table(
        "album_cover_search",
        sa.Column("key", sa.String(length=64), nullable=False),
        sa.Column("album", sa.String(length=512), nullable=False),
        sa.Column("artist", sa.String(length=512), nullable=False),
        sa.Column("covers", sa.JSON(), nullable=False),
        sa.Column("found_at", medleyplay.persistence.schema.UtcDateTime(), nullable=False),
        sa.Column("offered", sa.JSON(), server_default="[]", nullable=False),
        sa.Column("pick", sa.String(length=36), nullable=True),
        sa.Column("why", sa.String(length=300), server_default="", nullable=False),
        sa.Column("model", sa.String(length=128), server_default="", nullable=False),
        sa.Column("host", sa.String(length=255), server_default="", nullable=False),
        sa.Column("chosen_at", medleyplay.persistence.schema.UtcDateTime(), nullable=True),
        sa.PrimaryKeyConstraint("key", name=op.f("pk_album_cover_search")),
    )


def downgrade() -> None:
    """Revert this revision, forgetting the covers found for each album."""
    op.drop_table("album_cover_search")
