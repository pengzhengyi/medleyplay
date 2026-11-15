"""Keep what the household chose for an artist: the name it is shown by, a note, a photo.

Revision ID: 0041
Revises: 0040
Create Date: 2026-11-18 09:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import medleyplay.persistence.schema

revision: str = "0041"
down_revision: str | None = "0040"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Apply this revision."""
    op.create_table(
        "artist_household",
        sa.Column("artist_id", sa.String(length=64), nullable=False),
        sa.Column("shown_as", sa.String(length=512), nullable=True),
        sa.Column("about", sa.String(length=1000), nullable=True),
        sa.Column("photo", sa.String(length=64), nullable=True),
        sa.Column("changed_at", medleyplay.persistence.schema.UtcDateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["artist_id"],
            ["artist.id"],
            name=op.f("fk_artist_household_artist_id_artist"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("artist_id", name=op.f("pk_artist_household")),
    )


def downgrade() -> None:
    """Revert this revision, forgetting what the household chose for each artist."""
    op.drop_table("artist_household")
