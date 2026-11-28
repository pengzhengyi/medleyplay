"""Pass the LAN helper's observed address to the web app without changing its transport peer."""

import ipaddress
from typing import Final

from starlette.requests import Request
from starlette.responses import PlainTextResponse
from starlette.types import ASGIApp, Receive, Scope, Send

_PEER_HEADER: Final = b"x-medleyplay-share-peer"
_PEER_STATE: Final = "medleyplay_share_peer"


def sharing_peer(request: Request) -> str | None:
    """Return the peer observed by Share rather than the Uvicorn transport peer."""
    peer: object = getattr(request.state, _PEER_STATE, None)
    return peer if isinstance(peer, str) else None


class ShareIngress:
    """Read the helper's observed address only on its authenticated private socket."""

    def __init__(self, app: ASGIApp, private_socket: str) -> None:
        """Wrap HTTP requests addressed to `private_socket` before the web app reads them."""
        self._app = app
        self._private = private_socket

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Leave direct requests alone; require an observed IP on the private ingress."""
        if scope["type"] != "http" or scope.get("server") != (self._private, None):
            await self._app(scope, receive, send)
            return
        peer = _observed_peer(scope)
        if peer is None:
            await PlainTextResponse("Invalid sharing peer.", status_code=400)(scope, receive, send)
            return
        headers = [(key, value) for key, value in scope["headers"] if key != _PEER_HEADER]
        state = {**scope.get("state", {}), _PEER_STATE: peer}
        await self._app({**scope, "state": state, "headers": headers}, receive, send)


def _observed_peer(scope: Scope) -> str | None:
    values = [value for key, value in scope["headers"] if key == _PEER_HEADER]
    if len(values) != 1:
        return None
    try:
        return str(ipaddress.IPv4Address(values[0].decode("ascii")))
    except ValueError:
        return None
