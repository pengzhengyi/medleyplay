"""Keep when the household has each enricher asked: manually, for the next songs, or for all.

Revision ID: 0022
Revises: 0021
Create Date: 2026-11-06 09:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import medleyplay.persistence.schema

revision: str = "0022"
down_revision: str | None = "0021"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Apply this revision; every enricher stays manual until an admin chooses otherwise."""
    op.create_table(
        "enricher_mode",
        sa.Column("enricher", sa.String(length=64), nullable=False),
        sa.Column("mode", sa.String(length=16), nullable=False),
        sa.Column("set_at", medleyplay.persistence.schema.UtcDateTime(), nullable=False),
        sa.PrimaryKeyConstraint("enricher", name=op.f("pk_enricher_mode")),
    )


def downgrade() -> None:
    """Revert this revision, so every enricher is asked manually again."""
    op.drop_table("enricher_mode")
