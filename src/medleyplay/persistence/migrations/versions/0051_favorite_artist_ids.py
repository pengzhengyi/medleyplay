"""Keep each favorite artist by the id of the Library's artist, not by a name.

A favorite whose name no song shows names no artist, and is dropped. Undone, each
favorite is kept by every name its artist goes by.

Revision ID: 0051
Revises: 0050
Create Date: 2026-11-18 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0051"
down_revision: str | None = "0050"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Apply this revision."""
    op.rename_table("favorite_artist", "favorite_artist_by_name")
    op.create_table(
        "favorite_artist",
        sa.Column("account_id", sa.Integer(), nullable=False),
        sa.Column("artist_id", sa.String(length=32), nullable=False),
        sa.ForeignKeyConstraint(
            ["account_id"],
            ["account.id"],
            name=op.f("fk_favorite_artist_account_id_account"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["artist_id"],
            ["library_artist.id"],
            name=op.f("fk_favorite_artist_artist_id_library_artist"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("account_id", "artist_id", name=op.f("pk_favorite_artist")),
    )
    op.execute(
        "INSERT OR IGNORE INTO favorite_artist (account_id, artist_id)"
        " SELECT favorite.account_id, named.artist_id"
        " FROM favorite_artist_by_name AS favorite"
        " JOIN artist_name AS named ON named.key = favorite.key"
    )
    op.drop_table("favorite_artist_by_name")


def downgrade() -> None:
    """Revert this revision, keeping each favorite by every name its artist goes by."""
    op.rename_table("favorite_artist", "favorite_artist_by_id")
    op.create_table(
        "favorite_artist",
        sa.Column("account_id", sa.Integer(), nullable=False),
        sa.Column("key", sa.String(length=512), nullable=False),
        sa.Column("name", sa.String(length=512), nullable=False),
        sa.ForeignKeyConstraint(
            ["account_id"],
            ["account.id"],
            name=op.f("fk_favorite_artist_account_id_account"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("account_id", "key", name=op.f("pk_favorite_artist")),
    )
    op.execute(
        "INSERT INTO favorite_artist (account_id, key, name)"
        " SELECT favorite.account_id, named.key, artist.name"
        " FROM favorite_artist_by_id AS favorite"
        " JOIN artist_name AS named ON named.artist_id = favorite.artist_id"
        " JOIN library_artist AS artist ON artist.id = favorite.artist_id"
    )
    op.drop_table("favorite_artist_by_id")
