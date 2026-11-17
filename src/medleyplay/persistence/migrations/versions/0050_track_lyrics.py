"""Keep each song's lyrics as each source has them.

Revision ID: 0050
Revises: 0049
Create Date: 2026-11-18 01:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import medleyplay.persistence.schema

revision: str = "0050"
down_revision: str | None = "0049"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Apply this revision."""
    op.create_table(
        "track_lyrics",
        sa.Column("track_id", sa.Integer(), nullable=False),
        sa.Column("origin", sa.String(length=16), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("instrumental", sa.Boolean(), nullable=False),
        sa.Column("found_at", medleyplay.persistence.schema.UtcDateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["track_id"],
            ["track.id"],
            name=op.f("fk_track_lyrics_track_id_track"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("track_id", "origin", name=op.f("pk_track_lyrics")),
    )


def downgrade() -> None:
    """Revert this revision, forgetting every song's lyrics."""
    op.drop_table("track_lyrics")
