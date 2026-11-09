"""Keep how long each play was listened to, and each Track's total for each Account.

A play recorded before now has no time, and every total starts at none.

Revision ID: 0030
Revises: 0029
Create Date: 2026-11-09 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0030"
down_revision: str | None = "0029"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Apply this revision."""
    with op.batch_alter_table("play") as play:
        play.add_column(sa.Column("listened_ms", sa.Integer(), nullable=True))
        play.create_check_constraint(
            op.f("ck_play_listened_ms"), "listened_ms IS NULL OR listened_ms >= 0"
        )
    with op.batch_alter_table("track_state") as state:
        state.add_column(
            sa.Column("listened_ms", sa.Integer(), server_default=sa.text("0"), nullable=False)
        )
        state.add_column(
            sa.Column("timed_plays", sa.Integer(), server_default=sa.text("0"), nullable=False)
        )
        state.create_check_constraint(op.f("ck_track_state_listened_ms"), "listened_ms >= 0")
        state.create_check_constraint(op.f("ck_track_state_timed_plays"), "timed_plays >= 0")


def downgrade() -> None:
    """Revert this revision."""
    with op.batch_alter_table("track_state") as state:
        state.drop_constraint(op.f("ck_track_state_timed_plays"), type_="check")
        state.drop_constraint(op.f("ck_track_state_listened_ms"), type_="check")
        state.drop_column("timed_plays")
        state.drop_column("listened_ms")
    with op.batch_alter_table("play") as play:
        play.drop_constraint(op.f("ck_play_listened_ms"), type_="check")
        play.drop_column("listened_ms")
