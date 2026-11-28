"""Store allowlisted download receipts independently of current Job status."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from medleyplay.persistence.schema import UtcDateTime

revision: str = "0067"
down_revision: str | None = "0066"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the local download history."""
    op.add_column("job", sa.Column("provider_http_status", sa.Integer(), nullable=True))
    op.create_table(
        "download_receipt",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "job_id", sa.Integer(), sa.ForeignKey("job.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("at", UtcDateTime(), nullable=False),
        sa.Column("event", sa.String(16), nullable=False),
        sa.Column("attempt", sa.Integer()),
        sa.Column("route", sa.String(16)),
        sa.Column("stage", sa.String(16)),
        sa.Column("part", sa.Integer()),
        sa.Column("reason", sa.String(32)),
        sa.Column("http_status", sa.Integer()),
        sa.Column("retry_at", UtcDateTime()),
        sqlite_autoincrement=True,
    )
    op.create_index("ix_download_receipt_job_id", "download_receipt", ["job_id", "id"])
    op.create_index("ix_download_receipt_at", "download_receipt", ["at"])


def downgrade() -> None:
    """Remove receipts without changing durable Holds or Job outcomes."""
    op.drop_table("download_receipt")
    op.drop_column("job", "provider_http_status")
