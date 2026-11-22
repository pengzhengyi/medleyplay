"""Keep whether the household dismissed a song's suggested lyrics.

Revision ID: 0060
Revises: 0059
Create Date: 2026-11-22 09:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0060"
down_revision: str | None = "0059"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Apply this revision."""
    with op.batch_alter_table("track_lyrics") as batch:
        batch.add_column(
            sa.Column("dismissed", sa.Boolean(), server_default=sa.false(), nullable=False)
        )


def downgrade() -> None:
    """Revert this revision."""
    with op.batch_alter_table("track_lyrics") as batch:
        batch.drop_column("dismissed")
