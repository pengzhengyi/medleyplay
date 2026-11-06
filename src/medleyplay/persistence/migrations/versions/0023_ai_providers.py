"""Keep several AI providers in order, each with its key's name and why it last failed.

The provider set up before keeps its key where it is, under `ai:key`, so the
Keychain is never touched here, and becomes the first.

Revision ID: 0023
Revises: 0022
Create Date: 2026-11-06 12:00:00.000000
"""

import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import medleyplay.persistence.schema

revision: str = "0023"
down_revision: str | None = "0022"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_KEY_SECRET = "ai:key"  # noqa: S105  # nosec B105 -- the name of a Keychain item, not a key


def upgrade() -> None:
    """Apply this revision, keeping the provider set up before as the first."""
    op.create_table(
        "ai_provider",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("base_url", sa.String(length=256), nullable=False),
        sa.Column("model", sa.String(length=128), nullable=False),
        sa.Column("key_secret", sa.String(length=64), nullable=True),
        sa.Column("saved_at", medleyplay.persistence.schema.UtcDateTime(), nullable=False),
        sa.Column("failure", sa.String(length=16), nullable=True),
        sa.Column("failed_at", medleyplay.persistence.schema.UtcDateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ai_provider")),
        sa.UniqueConstraint("base_url", "model", name=op.f("uq_ai_provider_base_url")),
    )
    connection = op.get_bind()
    for base_url, model, has_key, saved_at in connection.execute(
        sa.text("SELECT base_url, model, has_key, saved_at FROM ai_setting")
    ):
        connection.execute(
            sa.text(
                "INSERT INTO ai_provider (id, position, base_url, model, key_secret, saved_at)"
                " VALUES (:id, 0, :base_url, :model, :key_secret, :saved_at)"
            ),
            {
                "id": uuid.uuid4().hex,
                "base_url": base_url,
                "model": model,
                "key_secret": _KEY_SECRET if has_key else None,
                "saved_at": saved_at,
            },
        )
    op.drop_table("ai_setting")


def downgrade() -> None:
    """Revert this revision, keeping only the first provider.

    An earlier version reads a key under `ai:key` only, so a first provider whose key
    is kept under another name is kept without one, and its key is entered again there.
    """
    op.create_table(
        "ai_setting",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("base_url", sa.String(length=256), nullable=False),
        sa.Column("model", sa.String(length=128), nullable=False),
        sa.Column("has_key", sa.Boolean(), nullable=False),
        sa.Column("saved_at", medleyplay.persistence.schema.UtcDateTime(), nullable=False),
        sa.CheckConstraint("id = 1", name=op.f("ck_ai_setting_single")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ai_setting")),
    )
    op.get_bind().execute(
        sa.text(
            "INSERT INTO ai_setting (id, base_url, model, has_key, saved_at)"
            " SELECT 1, base_url, model, COALESCE(key_secret = :key_secret, 0),"
            " saved_at FROM ai_provider ORDER BY position LIMIT 1"
        ),
        {"key_secret": _KEY_SECRET},
    )
    op.drop_table("ai_provider")
