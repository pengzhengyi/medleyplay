"""Give each artist the Library's Tracks name an id, and bind every Track to its artists.

Each folded written name becomes an artist, except that names linked to one MusicBrainz
artist become one artist. Every Track's non-blank artist and album artist is bound to
the artist its name names.

Revision ID: 0046
Revises: 0045
Create Date: 2026-11-17 18:00:00.000000
"""

import unicodedata
import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0046"
down_revision: str | None = "0045"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

NAMESPACE = uuid.UUID("6f1d2b8e-3c4a-4e5f-9a7b-0c1d2e3f4a5b")
"""Ids are derived from the name or the MusicBrainz id, so migrating again gives the same ones."""


def _key(name: str) -> str:
    # How names were folded when this revision was written: NFKC, then case-folded.
    return unicodedata.normalize("NFKC", name.strip()).casefold()


def upgrade() -> None:
    """Apply this revision."""
    library_artist = op.create_table(
        "library_artist",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("name", sa.String(length=512), nullable=False),
        sa.Column("musicbrainz_id", sa.String(length=64), nullable=True),
        sa.ForeignKeyConstraint(
            ["musicbrainz_id"],
            ["artist.id"],
            name=op.f("fk_library_artist_musicbrainz_id_artist"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_library_artist")),
        sa.UniqueConstraint("musicbrainz_id", name=op.f("uq_library_artist_musicbrainz_id")),
    )
    artist_name = op.create_table(
        "artist_name",
        sa.Column("key", sa.String(length=512), nullable=False),
        sa.Column("artist_id", sa.String(length=32), nullable=False),
        sa.ForeignKeyConstraint(
            ["artist_id"],
            ["library_artist.id"],
            name=op.f("fk_artist_name_artist_id_library_artist"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("key", name=op.f("pk_artist_name")),
    )
    op.create_index(op.f("ix_artist_name_artist_id"), "artist_name", ["artist_id"])
    track_artist = op.create_table(
        "track_artist",
        sa.Column("track_id", sa.Integer(), nullable=False),
        sa.Column("album_artist", sa.Boolean(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("artist_id", sa.String(length=32), nullable=False),
        sa.Column("written", sa.String(length=512), nullable=False),
        sa.ForeignKeyConstraint(
            ["artist_id"],
            ["library_artist.id"],
            name=op.f("fk_track_artist_artist_id_library_artist"),
        ),
        sa.ForeignKeyConstraint(
            ["track_id"],
            ["track.id"],
            name=op.f("fk_track_artist_track_id_track"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "track_id", "album_artist", "position", name=op.f("pk_track_artist")
        ),
    )
    op.create_index(op.f("ix_track_artist_artist_id"), "track_artist", ["artist_id"])
    _bind_every_track(library_artist, artist_name, track_artist)


def _bind_every_track(
    library_artist: sa.Table, artist_name: sa.Table, track_artist: sa.Table
) -> None:
    connection = op.get_bind()
    links: dict[str, str | None] = {
        row.key: row.artist_id
        for row in connection.execute(sa.text("SELECT key, artist_id FROM artist_link"))
    }
    artists: dict[str, dict[str, object]] = {}
    names: dict[str, str] = {}
    bound: list[dict[str, object]] = []
    tracks = connection.execute(sa.text("SELECT id, artist, album_artist FROM track ORDER BY id"))
    for track_id, artist, album_artist in tracks:
        for is_album_artist, shown in ((False, artist), (True, album_artist)):
            written = (shown or "").strip()
            if not written:
                continue
            key = _key(written)
            if key not in names:
                musicbrainz_id = links.get(key)
                seed = key if musicbrainz_id is None else f"mb:{musicbrainz_id}"
                artist_id = uuid.uuid5(NAMESPACE, seed).hex
                artists.setdefault(
                    artist_id,
                    {"id": artist_id, "name": written, "musicbrainz_id": musicbrainz_id},
                )
                names[key] = artist_id
            bound.append(
                {
                    "track_id": track_id,
                    "album_artist": is_album_artist,
                    "position": 0,
                    "artist_id": names[key],
                    "written": written,
                }
            )
    if artists:
        op.bulk_insert(library_artist, list(artists.values()))
        op.bulk_insert(
            artist_name, [{"key": key, "artist_id": artist_id} for key, artist_id in names.items()]
        )
    if bound:
        op.bulk_insert(track_artist, bound)


def downgrade() -> None:
    """Revert this revision, forgetting every artist's id."""
    op.drop_index(op.f("ix_track_artist_artist_id"), table_name="track_artist")
    op.drop_table("track_artist")
    op.drop_index(op.f("ix_artist_name_artist_id"), table_name="artist_name")
    op.drop_table("artist_name")
    op.drop_table("library_artist")
