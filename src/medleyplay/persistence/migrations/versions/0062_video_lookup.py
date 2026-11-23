"""Keep video metadata until the submitting Account chooses its parts or dismisses it."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0062"
down_revision: str | None = "0061"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Apply this revision."""
    op.create_table(
        "video_lookup",
        sa.Column(
            "job_id", sa.Integer(), sa.ForeignKey("job.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column("result", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    """Revert this revision."""
    op.drop_table("video_lookup")
