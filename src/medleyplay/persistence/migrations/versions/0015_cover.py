"""Show a cover on each Track, kept with the other details by origin.

Revision ID: 0015
Revises: 0014
Create Date: 2026-10-31 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Apply this revision."""
    with op.batch_alter_table("track") as batch:
        batch.add_column(sa.Column("cover", sa.String(length=64), nullable=True))


def downgrade() -> None:
    """Revert this revision."""
    with op.batch_alter_table("track") as batch:
        batch.drop_column("cover")
