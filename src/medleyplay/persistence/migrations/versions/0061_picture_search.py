"""Keep source-linked picture search results separately from a model's suggestions."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0061"
down_revision: str | None = "0060"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Keep each target's latest successful search."""
    op.create_table(
        "picture_search",
        sa.Column("key", sa.String(length=64), nullable=False),
        sa.Column("images", sa.JSON(), nullable=False),
        sa.PrimaryKeyConstraint("key", name=op.f("pk_picture_search")),
    )


def downgrade() -> None:
    """Forget the discovered links."""
    op.drop_table("picture_search")
