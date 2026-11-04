"""Create the proxy table: what is shown of each site's proxy, whose URL is in the Keychain.

Revision ID: 0016
Revises: 0015
Create Date: 2026-11-04 09:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import medleyplay.persistence.schema

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Apply this revision."""
    op.create_table(
        "proxy",
        sa.Column("site", sa.String(length=64), nullable=False),
        sa.Column("scheme", sa.String(length=16), nullable=False),
        sa.Column("host", sa.String(length=255), nullable=False),
        sa.Column("port", sa.Integer(), nullable=False),
        sa.Column("has_login", sa.Boolean(), nullable=False),
        sa.Column("saved_at", medleyplay.persistence.schema.UtcDateTime(), nullable=False),
        sa.CheckConstraint("port BETWEEN 1 AND 65535", name=op.f("ck_proxy_port")),
        sa.CheckConstraint("scheme IN ('http', 'https', 'socks5h')", name=op.f("ck_proxy_scheme")),
        sa.PrimaryKeyConstraint("site", name=op.f("pk_proxy")),
    )


def downgrade() -> None:
    """Revert this revision."""
    op.drop_table("proxy")
