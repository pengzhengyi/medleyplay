"""Add the devices the household allowed, and its choice for new ones.

Revision ID: 0025
Revises: 0024
Create Date: 2026-11-07 18:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import medleyplay.persistence.schema

revision: str = "0025"
down_revision: str | None = "0024"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Apply this revision; browsers signed in now are let in the first time they ask."""
    op.create_table(
        "device",
        sa.Column("id", sa.String(length=16), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("label", sa.String(length=64), nullable=False),
        sa.Column("address", sa.String(length=64), nullable=False),
        sa.Column("allowed_at", medleyplay.persistence.schema.UtcDateTime(), nullable=False),
        sa.Column("last_seen_at", medleyplay.persistence.schema.UtcDateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_device")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_device_token_hash")),
    )
    op.create_table(
        "device_setting",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("document", sa.JSON(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", medleyplay.persistence.schema.UtcDateTime(), nullable=False),
        sa.CheckConstraint("id = 1", name=op.f("ck_device_setting_single")),
        sa.CheckConstraint("revision >= 1", name=op.f("ck_device_setting_revision")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_device_setting")),
    )
    with op.batch_alter_table("session") as session:
        session.add_column(sa.Column("device_id", sa.String(length=16), nullable=True))
        session.add_column(
            sa.Column(
                "from_before_devices", sa.Boolean(), server_default=sa.text("0"), nullable=False
            )
        )
        session.create_index(op.f("ix_session_device_id"), ["device_id"])
        session.create_foreign_key(
            op.f("fk_session_device_id_device"), "device", ["device_id"], ["id"], ondelete="CASCADE"
        )
    # Every browser signed in now signed in before devices were checked.
    op.execute("UPDATE session SET from_before_devices = 1")


def downgrade() -> None:
    """Revert this revision, forgetting every device and the household's choice."""
    with op.batch_alter_table("session") as session:
        session.drop_constraint(op.f("fk_session_device_id_device"), type_="foreignkey")
        session.drop_index(op.f("ix_session_device_id"))
        session.drop_column("from_before_devices")
        session.drop_column("device_id")
    op.drop_table("device_setting")
    op.drop_table("device")
