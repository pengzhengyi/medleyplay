"""Keep the picture of an artist an AI model picked among those a site found.

Revision ID: 0055
Revises: 0054
Create Date: 2026-11-19 01:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import medleyplay.persistence.schema

revision: str = "0055"
down_revision: str | None = "0054"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Apply this revision."""
    with op.batch_alter_table("artist_picture_search") as batch:
        batch.add_column(sa.Column("offered", sa.JSON(), server_default="[]", nullable=False))
        batch.add_column(sa.Column("pick", sa.String(length=128), nullable=True))
        batch.add_column(sa.Column("why", sa.String(length=300), server_default="", nullable=False))
        batch.add_column(
            sa.Column("hint", sa.String(length=500), server_default="", nullable=False)
        )
        batch.add_column(
            sa.Column("model", sa.String(length=128), server_default="", nullable=False)
        )
        batch.add_column(
            sa.Column("host", sa.String(length=255), server_default="", nullable=False)
        )
        batch.add_column(
            sa.Column("chosen_at", medleyplay.persistence.schema.UtcDateTime(), nullable=True)
        )


def downgrade() -> None:
    """Revert this revision."""
    with op.batch_alter_table("artist_picture_search") as batch:
        for column in ("chosen_at", "host", "model", "hint", "why", "pick", "offered"):
            batch.drop_column(column)
