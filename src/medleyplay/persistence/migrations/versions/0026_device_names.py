"""Let the household name each device it allowed.

Revision ID: 0026
Revises: 0025
Create Date: 2026-11-08 18:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0026"
down_revision: str | None = "0025"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Apply this revision; every device starts without a name, shown by its label."""
    with op.batch_alter_table("device") as device:
        device.add_column(sa.Column("name", sa.String(length=40), nullable=True))


def downgrade() -> None:
    """Revert this revision, forgetting every device's name."""
    with op.batch_alter_table("device") as device:
        device.drop_column("name")
