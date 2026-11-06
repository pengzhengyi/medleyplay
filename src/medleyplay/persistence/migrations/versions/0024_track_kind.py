"""Keep the kind of a Track an origin names: a song, or a whole album in one file.

Revision ID: 0024
Revises: 0023
Create Date: 2026-11-07 09:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0024"
down_revision: str | None = "0023"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Apply this revision; no origin names a kind yet, so each is worked out from its file."""
    with op.batch_alter_table("track") as track:
        track.add_column(sa.Column("kind", sa.String(length=8), nullable=True))


def downgrade() -> None:
    """Revert this revision, dropping the kinds the household named."""
    op.execute("DELETE FROM track_value WHERE field = 'kind'")
    with op.batch_alter_table("track") as track:
        track.drop_column("kind")
