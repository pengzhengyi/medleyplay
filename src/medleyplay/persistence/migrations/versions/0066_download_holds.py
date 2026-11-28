"""Persist provider Holds and admitted download attempts."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0066"
down_revision: str | None = "0065"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Keep existing Jobs identifiable as legacy Jobs."""
    op.add_column("job", sa.Column("provider_attempts", sa.Integer(), nullable=True))
    op.add_column("job", sa.Column("provider_route", sa.String(32), nullable=True))
    op.add_column("job", sa.Column("provider_backend", sa.String(64), nullable=True))
    op.add_column("proxy", sa.Column("generation", sa.String(32), nullable=True))
    op.execute(sa.text("UPDATE proxy SET generation = lower(hex(randomblob(16)))"))
    op.create_table(
        "download_hold",
        sa.Column("site", sa.String(64), primary_key=True),
        sa.Column("subject", sa.String(80), primary_key=True),
        sa.Column("part", sa.Integer(), primary_key=True),
        sa.Column("reason", sa.String(32), nullable=False),
        sa.Column("job_id", sa.Integer(), sa.ForeignKey("job.id", ondelete="SET NULL")),
        sa.Column("attempt", sa.Integer()),
    )
    op.create_table(
        "provider_dispatch",
        sa.Column("site", sa.String(64), primary_key=True),
        sa.Column("subject", sa.String(80), nullable=False),
        sa.Column("job_id", sa.Integer(), sa.ForeignKey("job.id", ondelete="SET NULL")),
    )


def downgrade() -> None:
    """Refuse to restore automatic provider dispatch while unresolved evidence exists."""
    state_exists = op.get_bind().scalar(
        sa.text(
            "SELECT EXISTS (SELECT 1 FROM download_hold)"
            " OR EXISTS (SELECT 1 FROM provider_dispatch)"
            """
            OR EXISTS (
                SELECT 1 FROM job
                WHERE (
                    kind = 'lookup_video'
                    OR (kind = 'download_source' AND json_extract(request, '$.site') = 'bilibili')
                    OR (kind = 'enrich_track'
                        AND json_extract(request, '$.enricher') = 'bilibili-details')
                ) AND (
                    state IN ('running', 'waiting', 'failed')
                    OR (state IN ('queued', 'cancelled')
                        AND (started_at IS NOT NULL OR attempts > 0 OR failure_kind IS NOT NULL))
                    OR (state = 'succeeded' AND kind = 'lookup_video' AND EXISTS (
                        SELECT 1 FROM video_lookup WHERE job_id = job.id
                            AND json_extract(result, '$.read.reason')
                                IN ('network', 'refused', 'fault')
                    ))
                )
            )
            """
        )
    )
    if state_exists:
        message = "Cannot downgrade while download Holds or unresolved provider work exists."
        raise RuntimeError(message)
    op.drop_table("provider_dispatch")
    op.drop_table("download_hold")
    op.drop_column("proxy", "generation")
    op.drop_column("job", "provider_backend")
    op.drop_column("job", "provider_route")
    op.drop_column("job", "provider_attempts")
