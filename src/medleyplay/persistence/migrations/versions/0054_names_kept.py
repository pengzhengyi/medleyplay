"""Keep the names MusicBrainz knows several artists by that the household keeps as one.

Revision ID: 0054
Revises: 0053
Create Date: 2026-11-18 23:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import medleyplay.persistence.schema

revision: str = "0054"
down_revision: str | None = "0053"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Apply this revision."""
    op.create_table(
        "name_kept",
        sa.Column("key", sa.String(length=512), nullable=False),
        sa.Column("written", sa.String(length=512), nullable=False),
        sa.Column("kept_at", medleyplay.persistence.schema.UtcDateTime(), nullable=False),
        sa.PrimaryKeyConstraint("key", name=op.f("pk_name_kept")),
    )


def downgrade() -> None:
    """Revert this revision."""
    op.drop_table("name_kept")
