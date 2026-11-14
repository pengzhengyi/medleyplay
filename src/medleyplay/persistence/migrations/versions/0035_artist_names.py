"""Keep every name of an artist that another site, Wikidata, gives, apart from MusicBrainz's.

Revision ID: 0035
Revises: 0034
Create Date: 2026-11-14 08:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import medleyplay.persistence.schema

revision: str = "0035"
down_revision: str | None = "0034"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Apply this revision."""
    with op.batch_alter_table("artist") as artist:
        artist.add_column(
            sa.Column("names_at", medleyplay.persistence.schema.UtcDateTime(), nullable=True)
        )
    with op.batch_alter_table("artist_alias", recreate="always") as alias:
        alias.add_column(
            sa.Column("origin", sa.String(length=16), server_default="musicbrainz", nullable=False)
        )
        alias.drop_constraint("pk_artist_alias", type_="primary")
        alias.create_primary_key("pk_artist_alias", ["artist_id", "origin", "name"])


def downgrade() -> None:
    """Revert this revision, forgetting the names Wikidata gave."""
    op.execute("DELETE FROM artist_alias WHERE origin != 'musicbrainz'")
    with op.batch_alter_table("artist_alias", recreate="always") as alias:
        alias.drop_constraint("pk_artist_alias", type_="primary")
        alias.create_primary_key("pk_artist_alias", ["artist_id", "name"])
        alias.drop_column("origin")
    with op.batch_alter_table("artist") as artist:
        artist.drop_column("names_at")
