"""Keep what was wrong with an AI provider's unusable answer, and the status it refused with.

A failure noted before now keeps neither.

Revision ID: 0033
Revises: 0032
Create Date: 2026-11-15 18:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0033"
down_revision: str | None = "0032"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Apply this revision."""
    with op.batch_alter_table("ai_provider") as provider:
        provider.add_column(sa.Column("failure_reason", sa.String(length=16), nullable=True))
        provider.add_column(sa.Column("failure_status", sa.Integer(), nullable=True))


def downgrade() -> None:
    """Revert this revision."""
    with op.batch_alter_table("ai_provider") as provider:
        provider.drop_column("failure_status")
        provider.drop_column("failure_reason")
