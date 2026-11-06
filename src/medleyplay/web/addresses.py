"""Where a device on the network can reach this server, so a page can show the way there."""

import ipaddress
from collections.abc import Iterable

from fastapi import APIRouter, Request
from pydantic import BaseModel

from medleyplay.web.deps import SignedInAccount

router = APIRouter(prefix="/api", tags=["server"])


class AddressesOut(BaseModel):
    """The names and addresses a phone on the same network may open, the surest first."""

    addresses: list[str]


@router.get("/addresses")
def addresses(request: Request, _: SignedInAccount) -> AddressesOut:
    """Return the server's addresses on the network, then its names, such as `mac-mini.local`."""
    hosts: tuple[str, ...] = request.app.state.allowed_hosts
    return AddressesOut(addresses=reachable_from_the_network(hosts))


def reachable_from_the_network(hosts: Iterable[str]) -> list[str]:
    """Return the IPv4 addresses and the dotted names of `hosts` another device can open.

    ```text
    localhost, 127.0.0.1, ::1, mac-mini     this machine alone, or not a name a phone finds
    169.254.10.4, fe80::1                   link-local, which changes and needs a zone
    192.168.1.20, mac-mini.local            kept, addresses first
    ```
    """
    found: list[str] = []
    names: list[str] = []
    for host in dict.fromkeys(hosts):
        try:
            address = ipaddress.ip_address(host)
        except ValueError:
            if "." in host and host != "localhost":
                names.append(host)
            continue
        if isinstance(address, ipaddress.IPv4Address) and not (
            address.is_loopback or address.is_link_local
        ):
            found.append(host)
    return found + names
