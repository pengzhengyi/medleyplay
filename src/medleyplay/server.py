"""The composition root: settings from the environment and the config file, and the app."""

import contextlib
import fcntl
import functools
import os
import socket
import sys
from collections.abc import AsyncIterator, Iterator, Mapping
from contextlib import asynccontextmanager, contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Final

from fastapi import FastAPI
from pwdlib import PasswordHash
from pwdlib.hashers.argon2 import Argon2Hasher
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application import Clock
from medleyplay.application.accounts import AccountService
from medleyplay.application.ai import AiService
from medleyplay.application.album_covers import AlbumCoverService, album_cover_kinds
from medleyplay.application.artist_pictures import ArtistPictureService, artist_picture_kinds
from medleyplay.application.artist_splits import ArtistSplitService
from medleyplay.application.artists import (
    ArtistService,
    artist_kinds,
)
from medleyplay.application.catalog import CatalogService
from medleyplay.application.changes import Changes
from medleyplay.application.connectivity import reachable
from medleyplay.application.covers import COVERS_FOLDER, CoverService
from medleyplay.application.details import DetailsService
from medleyplay.application.devices import DeviceService
from medleyplay.application.downloads import DownloadService, download_source_kind
from medleyplay.application.enrichment import EnrichmentService, enrich_track_kind
from medleyplay.application.events import Events
from medleyplay.application.image_links import ImageLinkService, image_link_kinds
from medleyplay.application.image_search import IMAGE_SEARCH, ImageSearchService, TavilyKeys
from medleyplay.application.job_runner import JobProcesses, JobRunner
from medleyplay.application.jobs import AnyJobKind, JobService
from medleyplay.application.libraries import LibraryService, scan_library_kind
from medleyplay.application.linked_accounts import LinkedAccountService
from medleyplay.application.links import LinkService
from medleyplay.application.lyrics import LyricsService
from medleyplay.application.lyrics_match import LyricsMatchService, lyrics_match_kinds
from medleyplay.application.lyrics_search import LyricsSearchService, lyrics_search_kinds
from medleyplay.application.manual_downloads import ManualDownloadService
from medleyplay.application.mode import ModeService
from medleyplay.application.network import probe_network
from medleyplay.application.playback import PlaybackService, cache_source_kind
from medleyplay.application.plugins import Lineup, PluginService
from medleyplay.application.policy import PolicyService
from medleyplay.application.preferences import PreferencesService
from medleyplay.application.proxies import ProxyService
from medleyplay.application.ratings import RatingsService
from medleyplay.application.remote import RemoteService
from medleyplay.application.secrets import KeychainSecrets, Secrets
from medleyplay.application.segments import SongsService
from medleyplay.application.settings import SettingsService
from medleyplay.application.shared_names import SharedNameService
from medleyplay.application.silences import SilenceService, find_silences_kind
from medleyplay.application.split_offers import LibrarySweep, SplitOfferService
from medleyplay.application.storage_folder import StorageFolder, show_in_finder
from medleyplay.application.storage_inspection import StorageInspection
from medleyplay.application.sweeper import EnrichmentSweeper
from medleyplay.application.throttle import SignInThrottle
from medleyplay.application.thumbnails import (
    RECONCILE_DELAY,
    THUMBNAILS_FOLDER,
    ThumbnailService,
    make_thumbnails_kind,
)
from medleyplay.application.video_lookups import LOOKUP_KIND, VideoLookups
from medleyplay.config import CONFIG_FILE, Config, load_config
from medleyplay.persistence.database import database_url, make_engine, make_sessionmaker, migrate
from medleyplay.persistence.revision import DatabaseRevision
from medleyplay.plugin_host.client import HostCommand, PluginHost
from medleyplay.plugin_host.loader import BUILT_IN_PLUGINS, plugin_names
from medleyplay.web.app import create_app
from medleyplay.web.cached import CachedAnswers
from medleyplay.web.deps import Services

DEFAULT_PORT: Final = 8000
JOBS_FOLDER: Final = "jobs"
INSTANCE_LOCK: Final = "server.lock"
DATA_DIR_VARIABLE: Final = "MEDLEYPLAY_DATA_DIR"
ALLOWED_HOSTS_VARIABLE: Final = "MEDLEYPLAY_ALLOWED_HOSTS"


@dataclass(frozen=True)
class Settings:
    """Where the server keeps its data, which host names it answers to, and safe mode.

    Everything else is in the config file in the data folder.
    """

    data_dir: Path
    allowed_hosts: tuple[str, ...]
    safe_mode: bool = False
    data_dir_chosen: bool = True
    """Whether someone chose the data folder, rather than it being the platform's default."""

    @classmethod
    def from_environment(
        cls, environ: Mapping[str, str], platform: str = sys.platform
    ) -> "Settings":
        """Read the settings from environment variables, falling back to defaults.

        `MEDLEYPLAY_DATA_DIR` overrides the data folder. `MEDLEYPLAY_ALLOWED_HOSTS`
        adds comma-separated host names, such as a router's DNS name for the server.
        """
        configured = environ.get(DATA_DIR_VARIABLE)
        data_dir = Path(configured) if configured else default_data_dir(environ, platform)
        extra = tuple(h.strip() for h in environ.get(ALLOWED_HOSTS_VARIABLE, "").split(",") if h)
        return cls(
            data_dir=data_dir,
            allowed_hosts=(*local_host_names(), *extra),
            data_dir_chosen=bool(configured),
        )


@dataclass(frozen=True)
class PluginSource:
    """Where plugins come from, and how to start the host that runs them."""

    package: str = BUILT_IN_PLUGINS
    command: HostCommand = field(default_factory=HostCommand)


def default_data_dir(environ: Mapping[str, str], platform: str = sys.platform) -> Path:
    """Return where medleyplay keeps its data unless told otherwise.

    On a Mac, a folder of its own in the Music folder, beside the music it plays;
    elsewhere, the platform's folder for an application's data.
    """
    if platform == "darwin":
        return Path.home() / "Music" / "medleyplay"
    xdg = environ.get("XDG_DATA_HOME")
    return (Path(xdg) if xdg else Path.home() / ".local" / "share") / "medleyplay"


def former_data_dir(platform: str = sys.platform) -> Path | None:
    """Return where medleyplay kept its data by default before, if that differs from now."""
    if platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "medleyplay"
    return None


def local_host_names() -> tuple[str, ...]:
    """Return the names and addresses LAN devices may use to reach this machine."""
    hostname = socket.gethostname()
    names = {"localhost", "127.0.0.1", "::1", hostname, f"{hostname.removesuffix('.local')}.local"}
    # An unresolvable hostname still leaves the names above.
    with contextlib.suppress(OSError):
        names.update(socket.gethostbyname_ex(hostname)[2])
    names.update(_primary_address())
    return tuple(sorted(names))


def _primary_address() -> set[str]:
    # Connecting a UDP socket sends nothing; it only asks the OS which address it
    # would route from.
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
        try:
            probe.connect(("192.0.2.1", 9))  # TEST-NET-1: never a real host
        except OSError:
            return set()
        return {str(probe.getsockname()[0])}


def utc_now() -> datetime:
    """Return the current instant in UTC."""
    return datetime.now(UTC)


def open_database(data_dir: Path) -> Engine:
    """Open the database in `data_dir`, creating the folder and migrating the schema."""
    data_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    engine = make_engine(database_url(data_dir))
    migrate(engine)
    return engine


# One argument for the database and folder, then settings with defaults; a statement a service.
def build_services(  # noqa: PLR0913, PLR0915
    engine: Engine,
    data_dir: Path,
    clock: Clock = utc_now,
    *,
    config: Config = Config(),  # noqa: B008 -- a frozen value
    safe_mode: bool = False,
    source: PluginSource = PluginSource(),
    kinds: Mapping[str, AnyJobKind] | None = None,
    secrets: Secrets | None = None,
) -> Services:
    """Return the services over the database in `data_dir`, configured by `config`.

    `kinds` are the Job kinds the server runs; Jobs keep their working folders in
    `jobs` in the data folder. Logins are kept in `secrets`, by default the Keychain.
    Every change the download policy depends on, every Job's change of state, and
    every change of the Mode asks it to evaluate; the services follow the Mode.
    """
    units = make_sessionmaker(engine)
    changes = Changes()
    available = plugin_names(source.package)
    enabled = () if safe_mode else config.enabled_plugins(available)
    lineup = Lineup(available, enabled, config.unknown_plugins(available), safe_mode)
    host = PluginHost(enabled, package=source.package, command=source.command) if enabled else None
    plugins = PluginService(units, clock, lineup, host, changes.tell)
    keychain = secrets or KeychainSecrets()
    linked = LinkedAccountService(units, clock, plugins, keychain, changes.tell)
    proxies = ProxyService(units, clock, keychain)
    ai = AiService(units, clock, keychain)
    tavily_keys = TavilyKeys(keychain)
    scan = scan_library_kind(clock, data_dir / COVERS_FOLDER)
    cache = cache_source_kind(data_dir)
    download = download_source_kind(data_dir, data_dir / JOBS_FOLDER, clock)
    enrich = enrich_track_kind(data_dir / COVERS_FOLDER, clock)
    artist_jobs = artist_kinds(clock, data_dir / COVERS_FOLDER)
    cover_jobs = album_cover_kinds(clock, data_dir / COVERS_FOLDER)
    link_jobs = image_link_kinds(clock, data_dir / COVERS_FOLDER)
    picture_jobs = artist_picture_kinds(clock, data_dir / COVERS_FOLDER)
    find_silences = find_silences_kind(clock)
    lyrics_jobs = lyrics_search_kinds(clock)
    match_jobs = lyrics_match_kinds(clock, lyrics_jobs, plugins)
    make_thumbnails = make_thumbnails_kind(data_dir / THUMBNAILS_FOLDER, data_dir / JOBS_FOLDER)
    job_kinds: dict[str, AnyJobKind] = {
        scan.name: scan,
        cache.name: cache,
        download.name: download,
        LOOKUP_KIND.name: LOOKUP_KIND,
        enrich.name: enrich,
        artist_jobs.find.name: artist_jobs.find,
        artist_jobs.names.name: artist_jobs.names,
        artist_jobs.choose.name: artist_jobs.choose,
        artist_jobs.describe.name: artist_jobs.describe,
        cover_jobs.find.name: cover_jobs.find,
        picture_jobs.find.name: picture_jobs.find,
        picture_jobs.choose.name: picture_jobs.choose,
        cover_jobs.choose.name: cover_jobs.choose,
        link_jobs.suggest.name: link_jobs.suggest,
        link_jobs.fetch.name: link_jobs.fetch,
        IMAGE_SEARCH.name: IMAGE_SEARCH,
        find_silences.name: find_silences,
        make_thumbnails.name: make_thumbnails,
        lyrics_jobs.find.name: lyrics_jobs.find,
        lyrics_jobs.choose.name: lyrics_jobs.choose,
        match_jobs.find.name: match_jobs.find,
        match_jobs.choose.name: match_jobs.choose,
        **(kinds or {}),
    }
    processes = JobProcesses(source.command, source.package)
    events = Events()
    checks = tuple(check.check() for check in config.mode.checks)
    mode = ModeService(
        units, clock, probe=probe_network, check=functools.partial(reachable, checks)
    )
    runner = JobRunner(
        units,
        clock,
        job_kinds,
        plugins,
        data_dir / JOBS_FOLDER,
        processes=processes,
        online=mode.online,
        logins=linked,
        proxies=proxies,
        ai=ai,
        tavily_key=tavily_keys.lend,
        events=events,
        network_failed=mode.check_soon,
    )
    jobs = JobService(units, clock, job_kinds, runner, events, mode.online)
    catalog = CatalogService(units, clock, changes.tell, mode.online)
    # A database from before built-in Playlists, or a restored one, gains them now.
    catalog.ensure_builtin_playlists()
    downloads = DownloadService(units, plugins, jobs, download, linked, data_dir, clock)
    policy = PolicyService(units, clock, downloads, plugins, data_dir, online=mode.online)
    changes.listen(policy.request)
    # A setting such as the album length changes how Tracks show on every open page.
    changes.listen(events.hear_change)
    events.listen(policy.request)
    # Each change of the Mode reaches the open browsers, the runner, and the policy.
    mode.listen(events.publish_mode)
    mode.listen(runner.follow_mode)
    mode.listen(policy.request)
    manual_downloads = ManualDownloadService(units, clock, jobs, downloads.folder, changes.tell)
    links = LinkService(units, clock, plugins, catalog, downloads, mode.online, proxies)
    enrichment = EnrichmentService(units, clock, plugins, jobs, enrich)
    songs = SongsService(units, clock, changes.tell)
    split_offers = SplitOfferService(units, clock, songs, enrichment)
    # Tracks added, scanned, or downloaded, Jobs ending, and settings changed may give
    # finding all more to ask, and Auto more to split.
    sweeper = EnrichmentSweeper(LibrarySweep(enrichment, split_offers))
    changes.listen(sweeper.request)
    events.listen(sweeper.request)
    thumbnails = ThumbnailService(
        clock,
        plugins,
        jobs,
        make_thumbnails,
        data_dir / COVERS_FOLDER,
        data_dir / THUMBNAILS_FOLDER,
    )
    # Images are kept by uploads and by Jobs, so a change or a Job ending, 30 s after the
    # first, asks what lacks thumbnails; an upload arrives as a change of the catalog.
    thumbnail_sweeper = EnrichmentSweeper(thumbnails, delay=RECONCILE_DELAY, what="thumbnails")
    changes.listen(thumbnail_sweeper.request)
    events.listen(thumbnail_sweeper.request)
    # Each Job ending may leave MusicBrainz idle for the next album with no cover, and a
    # change may give an album a cover, so both ask the album covers' sweep.
    album_covers = AlbumCoverService(units, plugins, jobs, cover_jobs, clock, changes.tell)
    cover_sweeper = EnrichmentSweeper(album_covers, what="album covers")
    changes.listen(cover_sweeper.request)
    events.listen(cover_sweeper.request)
    # A changed proxy makes a looked-up video's details stale, so they are looked up again.
    proxies.listen(links.forget_lookups)
    accounts = AccountService(
        units,
        PasswordHash((Argon2Hasher(),)),
        clock,
        SignInThrottle(clock),
        multiple_accounts=config.multiple_accounts,
        on_change=changes.tell,
    )
    playback = PlaybackService(units, plugins, jobs, cache, data_dir, downloads, mode.online)
    # Every write after the migration changes the revision the cached answers stand on.
    revision = DatabaseRevision()
    revision.watch(engine)
    with engine.connect() as connection:
        wal_enabled = connection.exec_driver_sql("PRAGMA journal_mode").scalar_one() == "wal"
    return Services(
        accounts=accounts,
        catalog=catalog,
        plugins=plugins,
        jobs=jobs,
        libraries=LibraryService(units, clock, plugins, jobs, scan, data_dir),
        playback=playback,
        linked=linked,
        proxies=proxies,
        links=links,
        video_lookups=VideoLookups(units, links, jobs, plugins),
        manual_downloads=manual_downloads,
        events=events,
        settings=SettingsService(units, clock, changes.tell),
        policy=policy,
        preferences=PreferencesService(units, clock),
        mode=mode,
        details=DetailsService(units, clock, changes.tell),
        songs=songs,
        split_offers=split_offers,
        silences=SilenceService(units, clock, plugins, jobs, find_silences, playback),
        covers=CoverService(units, clock, data_dir / COVERS_FOLDER, changes.tell),
        thumbnails=thumbnails,
        thumbnail_sweeper=thumbnail_sweeper,
        enrichment=enrichment,
        sweeper=sweeper,
        ai=ai,
        devices=_devices(units, clock, accounts, events),
        remote=_remote(clock, events),
        ratings=RatingsService(units, clock, changes.tell),
        artists=ArtistService(
            units,
            clock,
            plugins,
            jobs,
            artist_jobs,
            changes.tell,
            covers_folder=data_dir / COVERS_FOLDER,
        ),
        artist_splits=ArtistSplitService(units, clock, changes.tell),
        shared_names=SharedNameService(units, clock, changes.tell),
        album_covers=album_covers,
        cover_sweeper=cover_sweeper,
        artist_pictures=ArtistPictureService(units, plugins, jobs, picture_jobs),
        image_links=ImageLinkService(units, plugins, jobs, link_jobs, data_dir / COVERS_FOLDER),
        image_search=ImageSearchService(units, plugins, jobs, tavily_keys),
        lyrics=LyricsService(units, clock, changes.tell, jobs=jobs),
        lyrics_search=LyricsSearchService(units, plugins, jobs, lyrics_jobs, changes.tell),
        lyrics_match=LyricsMatchService(units, plugins, jobs, match_jobs.find),
        storage_folder=StorageFolder(
            downloads.folder,
            show_in_finder if sys.platform == "darwin" else None,
            home=Path.home(),
        ),
        storage_inspection=StorageInspection(
            data_dir,
            CONFIG_FILE,
            multiple_accounts=config.multiple_accounts,
            safe_mode=safe_mode,
            wal_enabled=wal_enabled,
        ),
        revision=revision,
        answers=CachedAnswers(revision),
    )


def _devices(
    units: sessionmaker[Session], clock: Clock, accounts: AccountService, events: Events
) -> DeviceService:
    devices = DeviceService(units, clock, accounts)
    # A device that starts waiting, or is answered, reaches the admins' open browsers.
    devices.listen(events.publish_devices)
    return devices


def _remote(clock: Clock, events: Events) -> RemoteService:
    remote = RemoteService(clock)
    # Each report reaches the account's open browsers, and each command its speaker.
    remote.listen(events.publish_remote)
    return remote


def build_app(settings: Settings, source: PluginSource = PluginSource()) -> FastAPI:
    """Return the server's app for `settings`.

    The app starts deciding the Mode and the plugin host, removes stale cache
    copies, and starts the Job runner and the download policy, which evaluates at
    once, when it starts; it stops them and closes the database when it shuts
    down. A config file that doesn't parse raises `ConfigError`; another server
    using the same data folder raises `AlreadyRunningError` as the app starts.
    """
    config = load_config(settings.data_dir / CONFIG_FILE)
    engine = open_database(settings.data_dir)
    services = build_services(
        engine, settings.data_dir, config=config, safe_mode=settings.safe_mode, source=source
    )

    @asynccontextmanager
    async def run_in_background(_: FastAPI) -> AsyncIterator[None]:
        try:
            with hold_instance_lock(settings.data_dir):
                services.mode.start()
                try:
                    services.plugins.start()
                    services.playback.sweep_cache()
                    services.playback.sweep_downloads()
                    services.covers.sweep()
                    services.thumbnails.tidy()
                    services.jobs.start()
                    services.policy.start()
                    services.sweeper.start()
                    services.thumbnail_sweeper.start()
                    services.cover_sweeper.start()
                    try:
                        yield
                    finally:
                        services.cover_sweeper.stop()
                        services.thumbnail_sweeper.stop()
                        services.sweeper.stop()
                        services.policy.stop()
                        services.jobs.stop()
                        services.plugins.close()
                finally:
                    services.mode.stop()
        finally:
            engine.dispose()

    return create_app(services, settings.allowed_hosts, lifespan=run_in_background)


class AlreadyRunningError(Exception):
    """Another server is using this data folder."""


@contextmanager
def hold_instance_lock(data_dir: Path) -> Iterator[None]:
    """Hold the data folder's server lock, so a second server can't run Jobs on it too."""
    with (data_dir / INSTANCE_LOCK).open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            message = f"Another medleyplay server is using {data_dir}."
            raise AlreadyRunningError(message) from None
        yield


def environment() -> Mapping[str, str]:
    """Return the process environment; a seam so tests never read the real one."""
    return os.environ
