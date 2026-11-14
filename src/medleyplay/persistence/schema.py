"""The tables. Alembic migrations create them; this module is the model they must match."""

import uuid
from datetime import UTC, datetime
from typing import override

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    Dialect,
    Float,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    String,
    Text,
    TypeDecorator,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.sql import text

# Constraint names are fixed so a later migration can refer to them.
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class UtcDateTime(TypeDecorator[datetime]):
    """A UTC instant: stored without an offset, since SQLite drops it, and read back aware."""

    impl = DateTime
    cache_ok = True

    @override
    def process_bind_param(self, value: datetime | None, dialect: Dialect) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            message = f"Refusing a naive datetime {value!r}; pass an aware UTC instant."
            raise ValueError(message)
        return value.astimezone(UTC).replace(tzinfo=None)

    @override
    def process_result_value(self, value: datetime | None, dialect: Dialect) -> datetime | None:
        return None if value is None else value.replace(tzinfo=UTC)


class Base(DeclarativeBase):
    """The declarative base every table derives from."""

    metadata = MetaData(naming_convention=NAMING_CONVENTION)


class AccountRow(Base):
    """An Account; `username` is stored in its canonical lowercase form."""

    __tablename__ = "account"
    __table_args__ = (CheckConstraint("role IN ('admin', 'member')", name="role"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(32), unique=True)
    display_name: Mapped[str] = mapped_column(String(64))
    password_hash: Mapped[str] = mapped_column(String(256))
    role: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(UtcDateTime)


class DeviceRow(Base):
    """A browser other than the host's that the household allowed.

    Its id is random, so an answer meant for a device since removed can't reach
    another; only a SHA-256 hash of its cookie's token is kept.
    """

    __tablename__ = "device"

    id: Mapped[str] = mapped_column(String(16), primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    label: Mapped[str] = mapped_column(String(64))
    address: Mapped[str] = mapped_column(String(64))
    allowed_at: Mapped[datetime] = mapped_column(UtcDateTime)
    last_seen_at: Mapped[datetime] = mapped_column(UtcDateTime)
    name: Mapped[str | None] = mapped_column(String(40))


class SessionRow(Base):
    """A signed-in browser; only a SHA-256 hash of its token is kept.

    `device_id` is the device it signed in on, None on the host's own browser;
    `from_before_devices` marks one started before devices were checked, whose
    browser is allowed the first time it asks.
    """

    __tablename__ = "session"

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(
        ForeignKey("account.id", ondelete="CASCADE"), index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    device_id: Mapped[str | None] = mapped_column(
        ForeignKey("device.id", ondelete="CASCADE"), index=True
    )
    from_before_devices: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("0")
    )
    created_at: Mapped[datetime] = mapped_column(UtcDateTime)
    last_seen_at: Mapped[datetime] = mapped_column(UtcDateTime)


class TrackRow(Base):
    """A piece of music; its ids are never reused."""

    __tablename__ = "track"
    # So a queue or a Playlist still naming a removed Track never plays another in its place.
    __table_args__ = ({"sqlite_autoincrement": True},)

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(512))
    artist: Mapped[str] = mapped_column(String(512), default="")
    album: Mapped[str] = mapped_column(String(512), default="")
    album_artist: Mapped[str] = mapped_column(String(512), default="")
    track_number: Mapped[int | None]
    disc_number: Mapped[int | None]
    year: Mapped[int | None]
    genre: Mapped[str] = mapped_column(String(512), default="")
    cover: Mapped[str | None] = mapped_column(String(64))
    """The cover shown, by name, if any."""
    kind: Mapped[str | None] = mapped_column(String(8))
    """The kind an origin names, if any; otherwise the kind is worked out from the file."""
    duration_ms: Mapped[int | None]
    added_at: Mapped[datetime] = mapped_column(UtcDateTime)


class TrackValueRow(Base):
    """One detail of a Track as one origin gives it; the Track's row holds the value shown."""

    __tablename__ = "track_value"

    track_id: Mapped[int] = mapped_column(
        ForeignKey("track.id", ondelete="CASCADE"), primary_key=True
    )
    field: Mapped[str] = mapped_column(String(32), primary_key=True)
    origin: Mapped[str] = mapped_column(String(32), primary_key=True)
    value: Mapped[str | int] = mapped_column(JSON)
    recorded_at: Mapped[datetime] = mapped_column(UtcDateTime)


class SegmentRow(Base):
    """One song inside an album file: a stretch of that file's Source, played as its own Track.

    The song ends where the next starts, and the last at the end of the file.
    `split_length_ms` is the file's length when it was split, to tell when it changed.
    """

    __tablename__ = "segment"
    # A removed song's id is never given to another, so an editor left open can't adopt it;
    # and an album file's Source can't go while its songs remain.
    __table_args__ = ({"sqlite_autoincrement": True},)

    id: Mapped[int] = mapped_column(primary_key=True)
    album_source_id: Mapped[int] = mapped_column(
        ForeignKey("source.id", ondelete="RESTRICT"), index=True
    )
    track_id: Mapped[int] = mapped_column(ForeignKey("track.id", ondelete="CASCADE"), unique=True)
    position: Mapped[int]
    start_ms: Mapped[int]
    title: Mapped[str] = mapped_column(String(512))
    artist: Mapped[str] = mapped_column(String(512), default="")
    split_length_ms: Mapped[int | None]


class VideoTextRow(Base):
    """The text of a Track's video, as pasted, read beside the file, or read from the site.

    `chapters` lists `{"start_ms": int, "title": str}` in order.
    """

    __tablename__ = "video_text"
    __table_args__ = (
        CheckConstraint("came_from IN ('household', 'file', 'site')", name="came_from"),
    )

    track_id: Mapped[int] = mapped_column(
        ForeignKey("track.id", ondelete="CASCADE"), primary_key=True
    )
    title: Mapped[str] = mapped_column(String(1_000))
    description: Mapped[str] = mapped_column(String(20_000))
    chapters: Mapped[list[dict[str, str | int]]] = mapped_column(JSON)
    came_from: Mapped[str] = mapped_column(String(16))
    recorded_at: Mapped[datetime] = mapped_column(UtcDateTime)


class CommunityRatingRow(Base):
    """What listeners on a site rated a Track's song, or its album, as its enricher last found.

    A Track has at most one of each per source; the source's next answer replaces them.
    """

    __tablename__ = "community_rating"
    __table_args__ = (
        CheckConstraint("rated_as IN ('song', 'album')", name="rated_as"),
        CheckConstraint("value >= 0 AND value <= 5", name="value"),
        CheckConstraint("votes >= 1", name="votes"),
    )

    track_id: Mapped[int] = mapped_column(
        ForeignKey("track.id", ondelete="CASCADE"), primary_key=True
    )
    source: Mapped[str] = mapped_column(String(64), primary_key=True)
    rated_as: Mapped[str] = mapped_column(String(8), primary_key=True)
    value: Mapped[float] = mapped_column(Float)
    votes: Mapped[int] = mapped_column(Integer)
    link: Mapped[str] = mapped_column(String(2_000))
    found_at: Mapped[datetime] = mapped_column(UtcDateTime)


class EnricherStopRow(Base):
    """An enricher the site refused: it asks nothing more until an admin resets it.

    A row exists only while the enricher is stopped.
    """

    __tablename__ = "enricher_stop"

    enricher: Mapped[str] = mapped_column(String(64), primary_key=True)
    stopped_at: Mapped[datetime] = mapped_column(UtcDateTime)
    reason: Mapped[str] = mapped_column(String(2048), default="")


class EnricherModeRow(Base):
    """When the household has an enricher asked; one without a row is asked manually."""

    __tablename__ = "enricher_mode"

    enricher: Mapped[str] = mapped_column(String(64), primary_key=True)
    mode: Mapped[str] = mapped_column(String(16))
    set_at: Mapped[datetime] = mapped_column(UtcDateTime)


class EnricherAskRow(Base):
    """When an enricher last asked its site about a subject, so it never asks twice in a day.

    The subject is a video's id, or a key made from a Track and what it was searched for.
    """

    __tablename__ = "enricher_ask"

    enricher: Mapped[str] = mapped_column(String(64), primary_key=True)
    subject: Mapped[str] = mapped_column(String(64), primary_key=True)
    asked_at: Mapped[datetime] = mapped_column(UtcDateTime)


class AiProviderRow(Base):
    """An AI provider the household set up; its key, if it has one, is in the Keychain.

    Jobs ask the providers by `position`, lowest first. `key_secret` is the name the
    key is kept under, or `None` for a provider that needs none, and `failure` is why
    the provider last gave no answer, at `failed_at`, until it answers again.
    """

    __tablename__ = "ai_provider"
    __table_args__ = (UniqueConstraint("base_url", "model"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    position: Mapped[int] = mapped_column()
    base_url: Mapped[str] = mapped_column(String(256))
    model: Mapped[str] = mapped_column(String(128))
    key_secret: Mapped[str | None] = mapped_column(String(64))
    saved_at: Mapped[datetime] = mapped_column(UtcDateTime)
    failure: Mapped[str | None] = mapped_column(String(16))
    failed_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    failure_reason: Mapped[str | None] = mapped_column(String(16))
    """What was wrong with an unusable answer, when `failure` says it was unusable."""
    failure_status: Mapped[int | None]
    """The status of the request the provider refused, when it refused one."""


class AiSuggestionRow(Base):
    """The song list an AI model suggested for a Track, replaced by its next suggestion.

    `songs` lists `{"start_ms": int, "title": str, "artist": str}` in order.
    """

    __tablename__ = "ai_suggestion"

    track_id: Mapped[int] = mapped_column(
        ForeignKey("track.id", ondelete="CASCADE"), primary_key=True
    )
    songs: Mapped[list[dict[str, str | int]]] = mapped_column(JSON)
    suggested_at: Mapped[datetime] = mapped_column(UtcDateTime)


class SourceRow(Base):
    """Where a Track's audio comes from; `(kind, locator)` is its natural key."""

    __tablename__ = "source"
    __table_args__ = (
        UniqueConstraint("kind", "locator", name="uq_source_kind_locator"),
        CheckConstraint("state IN ('ok', 'missing', 'unavailable', 'cant_play')", name="state"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    track_id: Mapped[int] = mapped_column(ForeignKey("track.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(64))
    locator: Mapped[str] = mapped_column(String(2048))
    fingerprint: Mapped[str | None] = mapped_column(String(128))
    state: Mapped[str] = mapped_column(String(16), default="ok")
    details: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)


class TrackStateRow(Base):
    """One Account's favorite, rating, and play history for one Track.

    `listened_ms` adds up how long the plays with a measured time were listened to,
    `timed_plays` of the `play_count`.
    """

    __tablename__ = "track_state"
    __table_args__ = (
        CheckConstraint("rating IS NULL OR rating BETWEEN 1 AND 5", name="rating"),
        CheckConstraint("play_count >= 0", name="play_count"),
        CheckConstraint("listened_ms >= 0", name="listened_ms"),
        CheckConstraint("timed_plays >= 0", name="timed_plays"),
    )

    account_id: Mapped[int] = mapped_column(
        ForeignKey("account.id", ondelete="CASCADE"), primary_key=True
    )
    track_id: Mapped[int] = mapped_column(
        ForeignKey("track.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    favorite: Mapped[bool] = mapped_column(default=False)
    rating: Mapped[int | None]
    play_count: Mapped[int] = mapped_column(default=0)
    last_played_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    listened_ms: Mapped[int] = mapped_column(default=0, server_default=text("0"))
    timed_plays: Mapped[int] = mapped_column(default=0, server_default=text("0"))


class FavoriteArtistRow(Base):
    """An artist one Account favorited, kept by its folded name while it is a favorite."""

    __tablename__ = "favorite_artist"

    account_id: Mapped[int] = mapped_column(
        ForeignKey("account.id", ondelete="CASCADE"), primary_key=True
    )
    key: Mapped[str] = mapped_column(String(512), primary_key=True)
    name: Mapped[str] = mapped_column(String(512))


class FavoriteAlbumRow(Base):
    """An album one Account favorited, kept by its folded artist and name while it is one."""

    __tablename__ = "favorite_album"

    account_id: Mapped[int] = mapped_column(
        ForeignKey("account.id", ondelete="CASCADE"), primary_key=True
    )
    artist_key: Mapped[str] = mapped_column(String(512), primary_key=True)
    album_key: Mapped[str] = mapped_column(String(512), primary_key=True)
    artist: Mapped[str] = mapped_column(String(512))
    album: Mapped[str] = mapped_column(String(512))


class AlbumRatingRow(Base):
    """An album one Account rated or reviewed elsewhere, as its last import named it.

    Kept whether or not the Library has the album, so one added later takes its
    rating. The keys are the names folded as `album_ratings` matches them.
    """

    __tablename__ = "album_rating"
    __table_args__ = (
        CheckConstraint("stars IS NULL OR stars BETWEEN 1 AND 5", name="stars"),
        Index("ix_album_rating_account_id_album_key", "account_id", "album_key"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("account.id", ondelete="CASCADE"))
    source_id: Mapped[str] = mapped_column(Text)
    """The album's id on the site it was rated on."""
    artist: Mapped[str] = mapped_column(Text)
    artist_localized: Mapped[str] = mapped_column(Text)
    album: Mapped[str] = mapped_column(Text)
    artist_key: Mapped[str] = mapped_column(Text)
    localized_key: Mapped[str] = mapped_column(Text)
    album_key: Mapped[str] = mapped_column(Text)
    plain_key: Mapped[str] = mapped_column(Text)
    """The album's key with any edition note set aside."""
    stars: Mapped[int | None]
    note: Mapped[str] = mapped_column(Text)


class PlayRow(Base):
    """One play of a Track by an Account, under an id the Account's client chose.

    `recorded_at` is when the server took it, and `cleared` hides it from History
    while it still marks the id as counted. `listened_ms` is how long it was listened
    to, as its page measured; `None` for a play recorded before pages measured.
    """

    __tablename__ = "play"
    __table_args__ = (
        Index("ix_play_account_id_played_at", "account_id", "played_at"),
        CheckConstraint("listened_ms IS NULL OR listened_ms >= 0", name="listened_ms"),
    )

    account_id: Mapped[int] = mapped_column(
        ForeignKey("account.id", ondelete="CASCADE"), primary_key=True
    )
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    track_id: Mapped[int] = mapped_column(ForeignKey("track.id", ondelete="CASCADE"), index=True)
    played_at: Mapped[datetime] = mapped_column(UtcDateTime)
    recorded_at: Mapped[datetime] = mapped_column(UtcDateTime)
    cleared: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("0"))
    listened_ms: Mapped[int | None]


class PlaylistRow(Base):
    """An Account's Playlist; the id is chosen by the client, so creating it is retry-safe.

    A smart playlist has `rules`, its rules document, in place of entries. A
    `builtin` one is kept by the server, at most one of each kind per Account.
    """

    __tablename__ = "playlist"
    __table_args__ = (Index("ix_playlist_account_builtin", "account_id", "builtin", unique=True),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    account_id: Mapped[int] = mapped_column(
        ForeignKey("account.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(128))
    rules: Mapped[dict[str, object] | None] = mapped_column(JSON)
    keep_downloaded: Mapped[bool] = mapped_column(default=False, server_default=text("0"))
    builtin: Mapped[str | None] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(UtcDateTime)
    updated_at: Mapped[datetime] = mapped_column(UtcDateTime)


class PlaylistEntryRow(Base):
    """One position in a Playlist."""

    __tablename__ = "playlist_entry"

    playlist_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("playlist.id", ondelete="CASCADE"), primary_key=True
    )
    position: Mapped[int] = mapped_column(primary_key=True)
    track_id: Mapped[int] = mapped_column(ForeignKey("track.id", ondelete="CASCADE"), index=True)


class PluginStateRow(Base):
    """What the core keeps about one plugin across restarts: whether it is faulted."""

    __tablename__ = "plugin_state"

    name: Mapped[str] = mapped_column(String(64), primary_key=True)
    faulted_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    fault_reason: Mapped[str] = mapped_column(String(2048), default="")


class JobRow(Base):
    """A Job; at most one active Job exists per kind and target."""

    __tablename__ = "job"
    __table_args__ = (
        CheckConstraint(
            "state IN ('waiting', 'queued', 'running', 'succeeded', 'failed', 'cancelled')",
            name="state",
        ),
        CheckConstraint("attempts >= 0 AND interruptions >= 0", name="counts"),
        Index(
            "ix_job_active_target",
            "kind",
            "target",
            unique=True,
            sqlite_where=text("state IN ('waiting', 'queued', 'running')"),
        ),
        Index("ix_job_state", "state"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(64))
    target: Mapped[str] = mapped_column(String(256))
    state: Mapped[str] = mapped_column(String(16))
    request: Mapped[dict[str, object]] = mapped_column(JSON)
    requested_by: Mapped[int | None] = mapped_column(ForeignKey("account.id", ondelete="SET NULL"))
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    interruptions: Mapped[int] = mapped_column(Integer, default=0)
    not_before: Mapped[datetime | None] = mapped_column(UtcDateTime)
    pid: Mapped[int | None]
    login_account_id: Mapped[int | None]
    """Whose login the Job uses; not a foreign key, so a removed Account just has none."""
    failure_kind: Mapped[str | None] = mapped_column(String(16))
    failure_message: Mapped[str] = mapped_column(String(2048), default="")
    created_at: Mapped[datetime] = mapped_column(UtcDateTime)
    started_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    finished_at: Mapped[datetime | None] = mapped_column(UtcDateTime)


class LibraryRow(Base):
    """A Library; `(kind, path)` is its natural key, and its ids are never reused."""

    __tablename__ = "library"
    __table_args__ = (
        UniqueConstraint("kind", "path", name="uq_library_kind_path"),
        CheckConstraint("kind IN ('folder', 'zip')", name="kind"),
        CheckConstraint("state IN ('online', 'offline')", name="state"),
        {"sqlite_autoincrement": True},
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(128))
    kind: Mapped[str] = mapped_column(String(16))
    path: Mapped[str] = mapped_column(String(4096))
    state: Mapped[str] = mapped_column(String(16), default="online")
    message: Mapped[str] = mapped_column(String(1024), default="")
    file_count: Mapped[int] = mapped_column(Integer, default=0)
    added_at: Mapped[datetime] = mapped_column(UtcDateTime)
    last_scanned_at: Mapped[datetime | None] = mapped_column(UtcDateTime)


class LinkedAccountRow(Base):
    """An Account's login on a site; the login itself is in the Keychain, never here."""

    __tablename__ = "linked_account"
    __table_args__ = (
        CheckConstraint("state IN ('valid', 'needs_sign_in')", name="state"),
        CheckConstraint("revision >= 1", name="revision"),
    )

    account_id: Mapped[int] = mapped_column(
        ForeignKey("account.id", ondelete="CASCADE"), primary_key=True
    )
    site: Mapped[str] = mapped_column(String(64), primary_key=True)
    state: Mapped[str] = mapped_column(String(16))
    expires_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    saved_at: Mapped[datetime] = mapped_column(UtcDateTime)
    revision: Mapped[int] = mapped_column(Integer)


class ProxyRow(Base):
    """A site's proxy as it is shown; its URL, which may hold a password, is in the Keychain."""

    __tablename__ = "proxy"
    __table_args__ = (
        CheckConstraint("scheme IN ('http', 'https', 'socks5h')", name="scheme"),
        CheckConstraint("port BETWEEN 1 AND 65535", name="port"),
    )

    site: Mapped[str] = mapped_column(String(64), primary_key=True)
    scheme: Mapped[str] = mapped_column(String(16))
    host: Mapped[str] = mapped_column(String(255))
    port: Mapped[int] = mapped_column(Integer)
    has_login: Mapped[bool] = mapped_column()
    saved_at: Mapped[datetime] = mapped_column(UtcDateTime)


class DownloadRow(Base):
    """A Source's Download: its file in the data folder's `downloads`, at the quality it got."""

    __tablename__ = "download"
    __table_args__ = (CheckConstraint("size >= 0", name="size"),)

    source_id: Mapped[int] = mapped_column(
        ForeignKey("source.id", ondelete="CASCADE"), primary_key=True
    )
    file_name: Mapped[str] = mapped_column(String(64))
    quality: Mapped[str] = mapped_column(String(32))
    backend: Mapped[str] = mapped_column(String(64))
    size: Mapped[int] = mapped_column(Integer)
    downloaded_at: Mapped[datetime] = mapped_column(UtcDateTime)
    last_served_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    last_wanted_at: Mapped[datetime | None] = mapped_column(UtcDateTime)


class PreferenceRow(Base):
    """An Account's preferences, as one document."""

    __tablename__ = "preference"
    __table_args__ = (CheckConstraint("revision >= 1", name="revision"),)

    account_id: Mapped[int] = mapped_column(
        ForeignKey("account.id", ondelete="CASCADE"), primary_key=True
    )
    document: Mapped[dict[str, object]] = mapped_column(JSON)
    revision: Mapped[int] = mapped_column(Integer)
    updated_at: Mapped[datetime] = mapped_column(UtcDateTime)


class SettingRow(Base):
    """The household's settings, as one document; the only row has id 1."""

    __tablename__ = "setting"
    __table_args__ = (
        CheckConstraint("id = 1", name="single"),
        CheckConstraint("revision >= 1", name="revision"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    document: Mapped[dict[str, object]] = mapped_column(JSON)
    revision: Mapped[int] = mapped_column(Integer)
    updated_at: Mapped[datetime] = mapped_column(UtcDateTime)


class ModeSettingRow(Base):
    """The Mode's setting and the metered networks, as one document; the only row has id 1."""

    __tablename__ = "mode_setting"
    __table_args__ = (
        CheckConstraint("id = 1", name="single"),
        CheckConstraint("revision >= 1", name="revision"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    document: Mapped[dict[str, object]] = mapped_column(JSON)
    revision: Mapped[int] = mapped_column(Integer)
    updated_at: Mapped[datetime] = mapped_column(UtcDateTime)


class DeviceSettingRow(Base):
    """Which devices the household admits, as one document; the only row has id 1."""

    __tablename__ = "device_setting"
    __table_args__ = (
        CheckConstraint("id = 1", name="single"),
        CheckConstraint("revision >= 1", name="revision"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    document: Mapped[dict[str, object]] = mapped_column(JSON)
    revision: Mapped[int] = mapped_column(Integer)
    updated_at: Mapped[datetime] = mapped_column(UtcDateTime)


class TidyKeptRow(Base):
    """A written name the household chose to keep, so tidying no longer offers it.

    `kind` is `artist`, for an artist or album artist, or `album`; `written` is the
    name exactly as the Tracks show it.
    """

    __tablename__ = "tidy_kept"

    kind: Mapped[str] = mapped_column(String(16), primary_key=True)
    written: Mapped[str] = mapped_column(String(512), primary_key=True)
    kept_at: Mapped[datetime] = mapped_column(UtcDateTime)
