"""Request dependencies: the services, and the signed-in Account."""

from dataclasses import dataclass
from typing import Annotated, Final

from fastapi import Cookie, Depends, Request

from medleyplay.application.accounts import AccountService
from medleyplay.application.ai import AiService
from medleyplay.application.catalog import CatalogService
from medleyplay.application.covers import CoverService
from medleyplay.application.details import DetailsService
from medleyplay.application.devices import DeviceService
from medleyplay.application.enrichment import EnrichmentService
from medleyplay.application.events import Events
from medleyplay.application.jobs import JobService
from medleyplay.application.libraries import LibraryService
from medleyplay.application.linked_accounts import LinkedAccountService
from medleyplay.application.links import LinkService
from medleyplay.application.manual_downloads import ManualDownloadService
from medleyplay.application.mode import ModeService
from medleyplay.application.playback import PlaybackService
from medleyplay.application.plugins import PluginService
from medleyplay.application.policy import PolicyService
from medleyplay.application.preferences import PreferencesService
from medleyplay.application.proxies import ProxyService
from medleyplay.application.segments import SongsService
from medleyplay.application.settings import SettingsService
from medleyplay.application.sweeper import EnrichmentSweeper
from medleyplay.domain.accounts import Account
from medleyplay.domain.devices import DeviceId
from medleyplay.domain.errors import NotSignedInError

SESSION_COOKIE: Final = "medleyplay_session"
DEVICE_COOKIE: Final = "medleyplay_device"


@dataclass(frozen=True)
class Services:
    """The application services one server shares across requests."""

    accounts: AccountService
    catalog: CatalogService
    plugins: PluginService
    jobs: JobService
    libraries: LibraryService
    playback: PlaybackService
    linked: LinkedAccountService
    proxies: ProxyService
    links: LinkService
    manual_downloads: ManualDownloadService
    events: Events
    settings: SettingsService
    policy: PolicyService
    preferences: PreferencesService
    mode: ModeService
    details: DetailsService
    songs: SongsService
    covers: CoverService
    enrichment: EnrichmentService
    sweeper: EnrichmentSweeper
    ai: AiService
    devices: DeviceService


def services_of(request: Request) -> Services:
    """Return the services of the app answering `request`."""
    return _services(request)


def _services(request: Request) -> Services:
    services = request.app.state.services
    if not isinstance(services, Services):  # pragma: no cover -- create_app always sets it
        message = "The app was built without services; use medleyplay.web.app.create_app."
        raise TypeError(message)
    return services


def _accounts(services: Annotated[Services, Depends(_services)]) -> AccountService:
    return services.accounts


def _catalog(services: Annotated[Services, Depends(_services)]) -> CatalogService:
    return services.catalog


def _plugins(services: Annotated[Services, Depends(_services)]) -> PluginService:
    return services.plugins


def _jobs(services: Annotated[Services, Depends(_services)]) -> JobService:
    return services.jobs


def _libraries(services: Annotated[Services, Depends(_services)]) -> LibraryService:
    return services.libraries


def _playback(services: Annotated[Services, Depends(_services)]) -> PlaybackService:
    return services.playback


def _linked(services: Annotated[Services, Depends(_services)]) -> LinkedAccountService:
    return services.linked


def _proxies(services: Annotated[Services, Depends(_services)]) -> ProxyService:
    return services.proxies


def _links(services: Annotated[Services, Depends(_services)]) -> LinkService:
    return services.links


def _manual_downloads(services: Annotated[Services, Depends(_services)]) -> ManualDownloadService:
    return services.manual_downloads


def _events(services: Annotated[Services, Depends(_services)]) -> Events:
    return services.events


def _settings(services: Annotated[Services, Depends(_services)]) -> SettingsService:
    return services.settings


def _policy(services: Annotated[Services, Depends(_services)]) -> PolicyService:
    return services.policy


def _preferences(services: Annotated[Services, Depends(_services)]) -> PreferencesService:
    return services.preferences


def _mode(services: Annotated[Services, Depends(_services)]) -> ModeService:
    return services.mode


def _details(services: Annotated[Services, Depends(_services)]) -> DetailsService:
    return services.details


def _songs(services: Annotated[Services, Depends(_services)]) -> SongsService:
    return services.songs


def _covers(services: Annotated[Services, Depends(_services)]) -> CoverService:
    return services.covers


def _enrichment(services: Annotated[Services, Depends(_services)]) -> EnrichmentService:
    return services.enrichment


def _ai(services: Annotated[Services, Depends(_services)]) -> AiService:
    return services.ai


def _devices(services: Annotated[Services, Depends(_services)]) -> DeviceService:
    return services.devices


def _this_device(request: Request) -> DeviceId | None:
    device_id = getattr(request.state, "device_id", None)
    return None if device_id is None else DeviceId(device_id)


AccountsDep = Annotated[AccountService, Depends(_accounts)]
CatalogDep = Annotated[CatalogService, Depends(_catalog)]
PluginsDep = Annotated[PluginService, Depends(_plugins)]
JobsDep = Annotated[JobService, Depends(_jobs)]
LibrariesDep = Annotated[LibraryService, Depends(_libraries)]
PlaybackDep = Annotated[PlaybackService, Depends(_playback)]
LinkedDep = Annotated[LinkedAccountService, Depends(_linked)]
ProxiesDep = Annotated[ProxyService, Depends(_proxies)]
LinksDep = Annotated[LinkService, Depends(_links)]
ManualDownloadsDep = Annotated[ManualDownloadService, Depends(_manual_downloads)]
EventsDep = Annotated[Events, Depends(_events)]
SettingsDep = Annotated[SettingsService, Depends(_settings)]
PolicyDep = Annotated[PolicyService, Depends(_policy)]
PreferencesDep = Annotated[PreferencesService, Depends(_preferences)]
ModeDep = Annotated[ModeService, Depends(_mode)]
DetailsDep = Annotated[DetailsService, Depends(_details)]
SongsDep = Annotated[SongsService, Depends(_songs)]
CoversDep = Annotated[CoverService, Depends(_covers)]
EnrichmentDep = Annotated[EnrichmentService, Depends(_enrichment)]
AiDep = Annotated[AiService, Depends(_ai)]
DevicesDep = Annotated[DeviceService, Depends(_devices)]
SessionToken = Annotated[str | None, Cookie(alias=SESSION_COOKIE, include_in_schema=False)]
DeviceToken = Annotated[str | None, Cookie(alias=DEVICE_COOKIE, include_in_schema=False)]
ThisDevice = Annotated[DeviceId | None, Depends(_this_device)]
"""The allowed device making the request, as the device check found it; None for the host."""


def _signed_in(accounts: AccountsDep, token: SessionToken = None) -> Account:
    if token is None:
        raise NotSignedInError
    return accounts.authenticate(token)


SignedInAccount = Annotated[Account, Depends(_signed_in)]
