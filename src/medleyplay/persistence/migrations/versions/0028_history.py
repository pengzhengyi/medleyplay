"""Keep when each play was recorded and whether History was cleared of it.

A play recorded before now counts as recorded when it was played; none is cleared.

Revision ID: 0028
Revises: 0027
Create Date: 2026-11-08 21:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import medleyplay.persistence.schema

revision: str = "0028"
down_revision: str | None = "0027"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Apply this revision."""
    with op.batch_alter_table("play") as play:
        play.add_column(
            sa.Column("recorded_at", medleyplay.persistence.schema.UtcDateTime(), nullable=True)
        )
        play.add_column(
            sa.Column("cleared", sa.Boolean(), server_default=sa.text("0"), nullable=False)
        )
    op.execute("UPDATE play SET recorded_at = played_at")
    with op.batch_alter_table("play") as play:
        play.alter_column(
            "recorded_at",
            existing_type=medleyplay.persistence.schema.UtcDateTime(),
            nullable=False,
        )
        play.create_index("ix_play_account_id_played_at", ["account_id", "played_at"])


def downgrade() -> None:
    """Revert this revision."""
    with op.batch_alter_table("play") as play:
        play.drop_index("ix_play_account_id_played_at")
        play.drop_column("cleared")
        play.drop_column("recorded_at")
