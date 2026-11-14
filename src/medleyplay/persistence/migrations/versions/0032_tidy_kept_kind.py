"""Keep a name as written for what it names: an artist's, or an album's.

Every name kept before now is an artist's.

Revision ID: 0032
Revises: 0031
Create Date: 2026-11-15 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import medleyplay.persistence.schema

revision: str = "0032"
down_revision: str | None = "0031"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Apply this revision."""
    op.create_table(
        "tidy_kept_new",
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("written", sa.String(length=512), nullable=False),
        sa.Column("kept_at", medleyplay.persistence.schema.UtcDateTime(), nullable=False),
        sa.PrimaryKeyConstraint("kind", "written", name=op.f("pk_tidy_kept")),
    )
    op.execute(
        "INSERT INTO tidy_kept_new (kind, written, kept_at) "
        "SELECT 'artist', written, kept_at FROM tidy_kept"
    )
    op.drop_table("tidy_kept")
    op.rename_table("tidy_kept_new", "tidy_kept")


def downgrade() -> None:
    """Revert this revision; the album names kept are forgotten."""
    op.create_table(
        "tidy_kept_old",
        sa.Column("written", sa.String(length=512), nullable=False),
        sa.Column("kept_at", medleyplay.persistence.schema.UtcDateTime(), nullable=False),
        sa.PrimaryKeyConstraint("written", name=op.f("pk_tidy_kept")),
    )
    op.execute(
        "INSERT INTO tidy_kept_old (written, kept_at) "
        "SELECT written, kept_at FROM tidy_kept WHERE kind = 'artist'"
    )
    op.drop_table("tidy_kept")
    op.rename_table("tidy_kept_old", "tidy_kept")
