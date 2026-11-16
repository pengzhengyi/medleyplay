"""Keep what became of the song list offered for a long file: kept as one file, or failed.

Revision ID: 0045
Revises: 0044
Create Date: 2026-11-17 09:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import medleyplay.persistence.schema

revision: str = "0045"
down_revision: str | None = "0044"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Apply this revision."""
    op.create_table(
        "split_offer_state",
        sa.Column("track_id", sa.Integer(), nullable=False),
        sa.Column("kept_at", medleyplay.persistence.schema.UtcDateTime(), nullable=True),
        sa.Column("failed", sa.String(length=4096), nullable=True),
        sa.ForeignKeyConstraint(
            ["track_id"],
            ["track.id"],
            name=op.f("fk_split_offer_state_track_id_track"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("track_id", name=op.f("pk_split_offer_state")),
    )


def downgrade() -> None:
    """Revert this revision, forgetting which long files were kept as one."""
    op.drop_table("split_offer_state")
