"""Let a name name several artists, and keep the artist chosen for a song among them.

Revision ID: 0053
Revises: 0052
Create Date: 2026-11-18 20:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import medleyplay.persistence.schema

revision: str = "0053"
down_revision: str | None = "0052"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Apply this revision."""
    with op.batch_alter_table("artist_name", recreate="always") as batch:
        batch.add_column(sa.Column("position", sa.Integer(), server_default="0", nullable=False))
        batch.drop_constraint("pk_artist_name", type_="primary")
        batch.create_primary_key("pk_artist_name", ["key", "artist_id"])
    op.create_table(
        "track_artist_choice",
        sa.Column("track_id", sa.Integer(), nullable=False),
        sa.Column("key", sa.String(length=512), nullable=False),
        sa.Column("artist_id", sa.String(length=32), nullable=False),
        sa.Column("chosen_at", medleyplay.persistence.schema.UtcDateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["artist_id"],
            ["library_artist.id"],
            name=op.f("fk_track_artist_choice_artist_id_library_artist"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["track_id"],
            ["track.id"],
            name=op.f("fk_track_artist_choice_track_id_track"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("track_id", "key", name=op.f("pk_track_artist_choice")),
    )
    op.create_index(op.f("ix_track_artist_choice_artist_id"), "track_artist_choice", ["artist_id"])


def downgrade() -> None:
    """Revert this revision: each name names only its first artist, as songs are bound again."""
    op.drop_index(op.f("ix_track_artist_choice_artist_id"), table_name="track_artist_choice")
    op.drop_table("track_artist_choice")
    op.execute("DELETE FROM artist_name WHERE position > 0")
    with op.batch_alter_table("artist_name", recreate="always") as batch:
        batch.drop_constraint("pk_artist_name", type_="primary")
        batch.create_primary_key("pk_artist_name", ["key"])
        batch.drop_column("position")
