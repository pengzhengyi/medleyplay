"""Keep what an AI model last suggested for an artist: a name to show it by, and a note.

Revision ID: 0042
Revises: 0041
Create Date: 2026-11-19 09:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import medleyplay.persistence.schema

revision: str = "0042"
down_revision: str | None = "0041"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Apply this revision."""
    op.create_table(
        "artist_suggestion",
        sa.Column("artist_id", sa.String(length=64), nullable=False),
        sa.Column("offered", sa.JSON(), server_default="[]", nullable=False),
        sa.Column("shown_as", sa.String(length=512), nullable=True),
        sa.Column("why", sa.String(length=300), nullable=False),
        sa.Column("about", sa.String(length=400), nullable=False),
        sa.Column("model", sa.String(length=128), nullable=False),
        sa.Column("host", sa.String(length=255), nullable=False),
        sa.Column("answered_at", medleyplay.persistence.schema.UtcDateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["artist_id"],
            ["artist.id"],
            name=op.f("fk_artist_suggestion_artist_id_artist"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("artist_id", name=op.f("pk_artist_suggestion")),
    )


def downgrade() -> None:
    """Revert this revision, forgetting what AI models suggested for each artist."""
    op.drop_table("artist_suggestion")
