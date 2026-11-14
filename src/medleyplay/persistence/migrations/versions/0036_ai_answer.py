"""Keep which AI model last answered for each Track, and the host it was asked at.

Revision ID: 0036
Revises: 0035
Create Date: 2026-11-15 08:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import medleyplay.persistence.schema

revision: str = "0036"
down_revision: str | None = "0035"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Apply this revision."""
    op.create_table(
        "ai_answer",
        sa.Column("track_id", sa.Integer(), nullable=False),
        sa.Column("model", sa.String(length=128), nullable=False),
        sa.Column("host", sa.String(length=256), nullable=False),
        sa.Column("answered_at", medleyplay.persistence.schema.UtcDateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["track_id"],
            ["track.id"],
            name=op.f("fk_ai_answer_track_id_track"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("track_id", name=op.f("pk_ai_answer")),
    )


def downgrade() -> None:
    """Revert this revision."""
    op.drop_table("ai_answer")
