"""Remember which artist names written as several are split, and how songs credit each artist.

Revision ID: 0047
Revises: 0046
Create Date: 2026-11-17 21:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import medleyplay.persistence.schema

revision: str = "0047"
down_revision: str | None = "0046"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Apply this revision."""
    op.create_table(
        "name_split",
        sa.Column("key", sa.String(length=512), nullable=False),
        sa.Column("written", sa.String(length=512), nullable=False),
        sa.Column("split", sa.Boolean(), nullable=False),
        sa.Column("parts", sa.JSON(), nullable=False),
        sa.Column("decided_at", medleyplay.persistence.schema.UtcDateTime(), nullable=False),
        sa.PrimaryKeyConstraint("key", name=op.f("pk_name_split")),
    )
    with op.batch_alter_table("track_artist") as batch:
        batch.add_column(
            sa.Column("role", sa.String(length=16), server_default="main", nullable=False)
        )


def downgrade() -> None:
    """Revert this revision, forgetting every name split and every artist featured."""
    with op.batch_alter_table("track_artist") as batch:
        batch.drop_column("role")
    op.drop_table("name_split")
