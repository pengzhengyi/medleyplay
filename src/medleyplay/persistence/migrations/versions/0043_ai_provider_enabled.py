"""Let an admin turn an AI provider off, keeping its place and key.

Revision ID: 0043
Revises: 0042
Create Date: 2026-11-16 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0043"
down_revision: str | None = "0042"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Apply this revision; every provider set up already stays on."""
    op.add_column(
        "ai_provider",
        sa.Column("enabled", sa.Boolean(), server_default=sa.text("1"), nullable=False),
    )


def downgrade() -> None:
    """Revert this revision, turning every provider back on."""
    with op.batch_alter_table("ai_provider") as batch:
        batch.drop_column("enabled")
