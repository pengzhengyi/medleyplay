"""Keep the AI provider the household set up, and the song lists an AI model suggested.

The provider's key is in the Keychain; the catalog keeps its address, its model, and
whether there is a key.

Revision ID: 0020
Revises: 0019
Create Date: 2026-11-06 09:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import medleyplay.persistence.schema

revision: str = "0020"
down_revision: str | None = "0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Apply this revision."""
    op.create_table(
        "ai_setting",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("base_url", sa.String(length=256), nullable=False),
        sa.Column("model", sa.String(length=128), nullable=False),
        sa.Column("has_key", sa.Boolean(), nullable=False),
        sa.Column("saved_at", medleyplay.persistence.schema.UtcDateTime(), nullable=False),
        sa.CheckConstraint("id = 1", name=op.f("ck_ai_setting_single")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ai_setting")),
    )
    op.create_table(
        "ai_suggestion",
        sa.Column("track_id", sa.Integer(), nullable=False),
        sa.Column("songs", sa.JSON(), nullable=False),
        sa.Column("suggested_at", medleyplay.persistence.schema.UtcDateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["track_id"],
            ["track.id"],
            name=op.f("fk_ai_suggestion_track_id_track"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("track_id", name=op.f("pk_ai_suggestion")),
    )


def downgrade() -> None:
    """Revert this revision, forgetting the provider and the suggested song lists.

    The values an AI model suggested are Track details of the origin `ai`, which an
    earlier version never reads, so they are dropped with the lists.
    """
    op.execute("DELETE FROM track_value WHERE origin = 'ai'")
    op.drop_table("ai_suggestion")
    op.drop_table("ai_setting")
