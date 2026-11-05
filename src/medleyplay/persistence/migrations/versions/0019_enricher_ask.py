"""Keep when an enricher last asked about any subject, not only a video.

A video is one kind of subject; the MusicBrainz enricher's is a Track and what it
searched for. The table `video_ask` becomes `enricher_ask` and keeps its rows.

Revision ID: 0019
Revises: 0018
Create Date: 2026-11-05 15:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import medleyplay.persistence.schema

revision: str = "0019"
down_revision: str | None = "0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Apply this revision."""
    op.create_table(
        "enricher_ask",
        sa.Column("enricher", sa.String(length=64), nullable=False),
        sa.Column("subject", sa.String(length=64), nullable=False),
        sa.Column("asked_at", medleyplay.persistence.schema.UtcDateTime(), nullable=False),
        sa.PrimaryKeyConstraint("enricher", "subject", name=op.f("pk_enricher_ask")),
    )
    op.execute(
        "INSERT INTO enricher_ask (enricher, subject, asked_at)"
        " SELECT enricher, video, asked_at FROM video_ask"
    )
    op.drop_table("video_ask")


def downgrade() -> None:
    """Revert this revision, keeping every ask under the name it had."""
    op.create_table(
        "video_ask",
        sa.Column("enricher", sa.String(length=64), nullable=False),
        sa.Column("video", sa.String(length=64), nullable=False),
        sa.Column("asked_at", medleyplay.persistence.schema.UtcDateTime(), nullable=False),
        sa.PrimaryKeyConstraint("enricher", "video", name=op.f("pk_video_ask")),
    )
    op.execute(
        "INSERT INTO video_ask (enricher, video, asked_at)"
        " SELECT enricher, subject, asked_at FROM enricher_ask"
    )
    op.drop_table("enricher_ask")
