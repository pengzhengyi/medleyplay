"""Remember the artists the household chose for a song one by one.

Revision ID: 0049
Revises: 0048
Create Date: 2026-11-18 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import medleyplay.persistence.schema

revision: str = "0049"
down_revision: str | None = "0048"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Apply this revision."""
    op.create_table(
        "track_credits",
        sa.Column("track_id", sa.Integer(), nullable=False),
        sa.Column("credits", sa.JSON(), nullable=False),
        sa.Column("chosen_at", medleyplay.persistence.schema.UtcDateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["track_id"],
            ["track.id"],
            name=op.f("fk_track_credits_track_id_track"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("track_id", name=op.f("pk_track_credits")),
    )


def downgrade() -> None:
    """Revert this revision; each song's artists follow its name's decision again."""
    op.drop_table("track_credits")
