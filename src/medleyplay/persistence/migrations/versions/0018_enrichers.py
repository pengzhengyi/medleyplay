"""Keep what the site enrichers did: when each video was asked, and which are stopped.

A Track's video text can now also come from the site.

Revision ID: 0018
Revises: 0017
Create Date: 2026-11-05 09:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import medleyplay.persistence.schema

revision: str = "0018"
down_revision: str | None = "0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_CAME_FROM = "ck_video_text_came_from"


def upgrade() -> None:
    """Apply this revision."""
    op.create_table(
        "enricher_stop",
        sa.Column("enricher", sa.String(length=64), nullable=False),
        sa.Column("stopped_at", medleyplay.persistence.schema.UtcDateTime(), nullable=False),
        sa.Column("reason", sa.String(length=2048), nullable=False),
        sa.PrimaryKeyConstraint("enricher", name=op.f("pk_enricher_stop")),
    )
    op.create_table(
        "video_ask",
        sa.Column("enricher", sa.String(length=64), nullable=False),
        sa.Column("video", sa.String(length=64), nullable=False),
        sa.Column("asked_at", medleyplay.persistence.schema.UtcDateTime(), nullable=False),
        sa.PrimaryKeyConstraint("enricher", "video", name=op.f("pk_video_ask")),
    )
    with op.batch_alter_table("video_text") as batch:
        batch.drop_constraint(op.f(_CAME_FROM), type_="check")
        batch.create_check_constraint(
            op.f(_CAME_FROM), "came_from IN ('household', 'file', 'site')"
        )


def downgrade() -> None:
    """Revert this revision.

    Text read from the site becomes the household's, so the Track keeps the details
    it shows and no later scan replaces them.
    """
    op.execute("UPDATE video_text SET came_from = 'household' WHERE came_from = 'site'")
    with op.batch_alter_table("video_text") as batch:
        batch.drop_constraint(op.f(_CAME_FROM), type_="check")
        batch.create_check_constraint(op.f(_CAME_FROM), "came_from IN ('household', 'file')")
    op.drop_table("video_ask")
    op.drop_table("enricher_stop")
