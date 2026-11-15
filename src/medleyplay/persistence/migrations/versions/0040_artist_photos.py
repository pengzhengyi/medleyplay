"""Keep an artist's page on Wikidata, and its photo; ask Wikidata again for each.

Revision ID: 0040
Revises: 0039
Create Date: 2026-11-17 09:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0040"
down_revision: str | None = "0039"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Apply this revision, forgetting when Wikidata answered, so the next look-up asks again."""
    with op.batch_alter_table("artist") as artist:
        artist.add_column(sa.Column("page", sa.String(length=2048), nullable=True))
        artist.add_column(sa.Column("photo", sa.String(length=64), nullable=True))
        artist.add_column(sa.Column("photo_page", sa.String(length=2048), nullable=True))
    op.execute("UPDATE artist SET names_at = NULL")


def downgrade() -> None:
    """Revert this revision, forgetting every artist's page and photo."""
    with op.batch_alter_table("artist") as artist:
        artist.drop_column("photo_page")
        artist.drop_column("photo")
        artist.drop_column("page")
