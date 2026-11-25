"""Keep whether a failed download was dismissed from the Downloaded view."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0064"
down_revision: str | None = "0063"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Apply this revision."""
    op.add_column(
        "job",
        sa.Column("failure_dismissed", sa.Boolean(), nullable=False, server_default=sa.text("0")),
    )


def downgrade() -> None:
    """Revert this revision."""
    op.drop_column("job", "failure_dismissed")
