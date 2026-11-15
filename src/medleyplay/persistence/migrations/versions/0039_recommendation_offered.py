"""Keep the artists each AI recommendation was offered, to tell when it stops standing.

Revision ID: 0039
Revises: 0038
Create Date: 2026-11-16 09:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0039"
down_revision: str | None = "0038"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Apply this revision."""
    with op.batch_alter_table("artist_recommendation") as batch_op:
        batch_op.add_column(sa.Column("offered", sa.JSON(), server_default="[]", nullable=False))


def downgrade() -> None:
    """Revert this revision."""
    with op.batch_alter_table("artist_recommendation") as batch_op:
        batch_op.drop_column("offered")
