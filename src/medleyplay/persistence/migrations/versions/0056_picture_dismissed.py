"""Keep the pictures of an artist the household said are not of it.

Revision ID: 0056
Revises: 0055
Create Date: 2026-11-19 02:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0056"
down_revision: str | None = "0055"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Apply this revision."""
    with op.batch_alter_table("artist_picture_search") as batch:
        batch.add_column(sa.Column("dismissed", sa.JSON(), server_default="[]", nullable=False))


def downgrade() -> None:
    """Revert this revision."""
    with op.batch_alter_table("artist_picture_search") as batch:
        batch.drop_column("dismissed")
