"""Keep suggestions for missing credits apart from ordinary enrichment."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0063"
down_revision: str | None = "0062"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Apply this revision."""
    op.create_table(
        "missing_details",
        sa.Column(
            "track_id",
            sa.Integer(),
            sa.ForeignKey("track.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("key", sa.String(64), nullable=False),
        sa.Column("values", sa.JSON(), nullable=False),
    )


def downgrade() -> None:
    """Revert this revision."""
    op.drop_table("missing_details")
