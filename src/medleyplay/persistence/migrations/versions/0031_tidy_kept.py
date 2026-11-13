"""Remember the written artist names the household chose to keep rather than tidy.

Revision ID: 0031
Revises: 0030
Create Date: 2026-11-14 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import medleyplay.persistence.schema

revision: str = "0031"
down_revision: str | None = "0030"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Apply this revision."""
    op.create_table(
        "tidy_kept",
        sa.Column("written", sa.String(length=512), nullable=False),
        sa.Column("kept_at", medleyplay.persistence.schema.UtcDateTime(), nullable=False),
        sa.PrimaryKeyConstraint("written", name=op.f("pk_tidy_kept")),
    )


def downgrade() -> None:
    """Revert this revision."""
    op.drop_table("tidy_kept")
