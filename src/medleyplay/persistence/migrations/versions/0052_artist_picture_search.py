"""Keep the pictures a site last found of each artist.

Revision ID: 0052
Revises: 0051
Create Date: 2026-11-18 18:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import medleyplay.persistence.schema

revision: str = "0052"
down_revision: str | None = "0051"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Apply this revision."""
    op.create_table(
        "artist_picture_search",
        sa.Column("artist_id", sa.String(length=64), nullable=False),
        sa.Column("site", sa.String(length=16), nullable=False),
        sa.Column("pictures", sa.JSON(), nullable=False),
        sa.Column("found_at", medleyplay.persistence.schema.UtcDateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["artist_id"],
            ["artist.id"],
            name=op.f("fk_artist_picture_search_artist_id_artist"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("artist_id", "site", name=op.f("pk_artist_picture_search")),
    )


def downgrade() -> None:
    """Revert this revision, forgetting the pictures found."""
    op.drop_table("artist_picture_search")
