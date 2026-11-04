"""Never give a removed Track's id to another.

Revision ID: 0016
Revises: 0015
Create Date: 2026-11-04 17:00:00.000000
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Apply this revision."""
    # Copying the rows into the rebuilt table starts its count at the highest id kept.
    with op.batch_alter_table(
        "track", recreate="always", table_kwargs={"sqlite_autoincrement": True}
    ):
        pass


def downgrade() -> None:
    """Revert this revision."""
    with op.batch_alter_table("track", recreate="always"):
        pass
    op.execute("DELETE FROM sqlite_sequence WHERE name = 'track'")
