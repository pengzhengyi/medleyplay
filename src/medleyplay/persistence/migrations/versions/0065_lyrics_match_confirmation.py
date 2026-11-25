"""Distinguish unsaved Auto-Match picks from confirmed lyrics."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0065"
down_revision: str | None = "0064"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Apply this revision."""
    op.add_column("lyrics_search", sa.Column("match_choice_job_id", sa.Integer(), nullable=True))
    op.add_column(
        "lyrics_search",
        sa.Column("match_confirmed", sa.Boolean(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    """Revert this revision."""
    op.drop_column("lyrics_search", "match_confirmed")
    op.drop_column("lyrics_search", "match_choice_job_id")
