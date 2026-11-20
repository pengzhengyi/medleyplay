"""Keep an AI model's pick of the songs found for a song's lyrics.

Revision ID: 0058
Revises: 0057
Create Date: 2026-11-19 18:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import medleyplay.persistence.schema

revision: str = "0058"
down_revision: str | None = "0057"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Apply this revision."""
    with op.batch_alter_table("lyrics_search") as batch:
        batch.add_column(sa.Column("offered", sa.JSON(), server_default="[]", nullable=False))
        batch.add_column(sa.Column("pick", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("why", sa.String(length=300), server_default="", nullable=False))
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
    with op.batch_alter_table("lyrics_search") as batch:
        for column in ("chosen_at", "host", "model", "why", "pick", "offered"):
            batch.drop_column(column)
