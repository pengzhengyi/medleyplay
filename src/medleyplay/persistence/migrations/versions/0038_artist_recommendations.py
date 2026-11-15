"""Keep the artist an AI model recommends linking each written name to, and why.

Revision ID: 0038
Revises: 0037
Create Date: 2026-11-15 18:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import medleyplay.persistence.schema

revision: str = "0038"
down_revision: str | None = "0037"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Apply this revision."""
    op.create_table(
        "artist_recommendation",
        sa.Column("key", sa.String(length=512), nullable=False),
        sa.Column("name", sa.String(length=512), nullable=False),
        sa.Column("artist_id", sa.String(length=64), nullable=True),
        sa.Column("why", sa.String(length=300), nullable=False),
        sa.Column("model", sa.String(length=128), nullable=False),
        sa.Column("host", sa.String(length=255), nullable=False),
        sa.Column("answered_at", medleyplay.persistence.schema.UtcDateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["artist_id"],
            ["artist.id"],
            name=op.f("fk_artist_recommendation_artist_id_artist"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("key", name=op.f("pk_artist_recommendation")),
    )


def downgrade() -> None:
    """Revert this revision."""
    op.drop_table("artist_recommendation")
