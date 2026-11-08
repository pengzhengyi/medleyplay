"""Keep what listeners on a site rated each Track's song and album, and ask MusicBrainz again.

MusicBrainz answered no ratings before, so its asked-once notes are forgotten: a Track
found on it can be asked again at once, and this time its ratings come too.

Revision ID: 0027
Revises: 0026
Create Date: 2026-11-08 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import medleyplay.persistence.schema

revision: str = "0027"
down_revision: str | None = "0026"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Apply this revision; no Track has a community rating until its enricher is asked."""
    op.create_table(
        "community_rating",
        sa.Column("track_id", sa.Integer(), nullable=False),
        sa.Column("source", sa.String(length=64), nullable=False),
        sa.Column("rated_as", sa.String(length=8), nullable=False),
        sa.Column("value", sa.Float(), nullable=False),
        sa.Column("votes", sa.Integer(), nullable=False),
        sa.Column("link", sa.String(length=2000), nullable=False),
        sa.Column("found_at", medleyplay.persistence.schema.UtcDateTime(), nullable=False),
        sa.CheckConstraint(
            "rated_as IN ('song', 'album')", name=op.f("ck_community_rating_rated_as")
        ),
        sa.CheckConstraint("value >= 0 AND value <= 5", name=op.f("ck_community_rating_value")),
        sa.CheckConstraint("votes >= 1", name=op.f("ck_community_rating_votes")),
        sa.ForeignKeyConstraint(
            ["track_id"],
            ["track.id"],
            name=op.f("fk_community_rating_track_id_track"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("track_id", "source", "rated_as", name=op.f("pk_community_rating")),
    )
    op.execute("DELETE FROM enricher_ask WHERE enricher = 'musicbrainz'")


def downgrade() -> None:
    """Revert this revision, forgetting every community rating."""
    op.drop_table("community_rating")
