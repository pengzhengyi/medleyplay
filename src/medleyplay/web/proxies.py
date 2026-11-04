"""The proxies API: an admin sets, shows, and removes the household's proxy for a site.

The proxy's URL may hold a password. It is read from the body as a secret, kept in
the Keychain, and never answered: the API shows only its address and whether it has
a login.
"""

from datetime import datetime

from fastapi import APIRouter, status
from pydantic import BaseModel, ConfigDict, SecretStr

from medleyplay.application.proxies import SavedProxy
from medleyplay.domain.proxies import ProxyScheme
from medleyplay.web.deps import ProxiesDep, SignedInAccount

router = APIRouter(prefix="/api/proxies", tags=["proxies"])


class ProxyIn(BaseModel):
    """A proxy to set: its URL, such as `socks5h://127.0.0.1:7890`, with a login if it has one."""

    model_config = ConfigDict(extra="forbid")

    url: SecretStr


class ProxyOut(BaseModel):
    """A proxy as the API shows it; its login never leaves the server."""

    scheme: ProxyScheme
    host: str
    port: int
    has_login: bool
    display: str
    """The proxy as an address, such as `socks5h://127.0.0.1:7890`."""
    saved_at: datetime

    @classmethod
    def of(cls, saved: SavedProxy) -> "ProxyOut":
        """Return the API view of `saved`."""
        summary = saved.summary
        return cls(
            scheme=summary.scheme,
            host=summary.host,
            port=summary.port,
            has_login=summary.has_login,
            display=summary.display,
            saved_at=saved.saved_at,
        )


@router.get("/{site}")
def get_proxy(site: str, me: SignedInAccount, proxies: ProxiesDep) -> ProxyOut | None:
    """Return the site's proxy, or null when none is set; admins only."""
    saved = proxies.get(me, site)
    return None if saved is None else ProxyOut.of(saved)


@router.put("/{site}")
def set_proxy(site: str, body: ProxyIn, me: SignedInAccount, proxies: ProxiesDep) -> ProxyOut:
    """Set the site's proxy from a URL; another shape answers 422, never echoing it."""
    return ProxyOut.of(proxies.save(me, site, body.url.get_secret_value()))


@router.delete("/{site}", status_code=status.HTTP_204_NO_CONTENT)
def remove_proxy(site: str, me: SignedInAccount, proxies: ProxiesDep) -> None:
    """Remove the site's proxy; 204 also when there is none."""
    proxies.remove(me, site)
