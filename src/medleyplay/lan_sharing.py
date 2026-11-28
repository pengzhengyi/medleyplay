"""Local control for the optional macOS LAN listener and its private Uvicorn ingress."""

import asyncio
import contextlib
import hashlib
import ipaddress
import os
import socket
import stat
import subprocess  # nosec B404 -- fixed macOS signature verifier, without a shell
import sys
import tempfile
from collections.abc import AsyncIterator, Callable, Iterator
from pathlib import Path
from typing import Final, Literal, cast, override

import uvicorn
from pydantic import BaseModel, Field, ValidationError
from starlette.types import ASGIApp
from uvicorn.protocols.http.h11_impl import H11Protocol

from medleyplay.config import ConfigError
from medleyplay.web.share_ingress import ShareIngress

SHARE_EXECUTABLE: Final = "medleyplay-share"
MAX_LAN_PORT: Final = 65535
_LOCAL_PEERPID: Final = 2
_SOL_LOCAL: Final = 0
_START_TIMEOUT: Final = 10.0
_STOP_TIMEOUT: Final = 2.0
_CONTROL_TIMEOUT: Final = 20.0
_CONTROL_LIMIT: Final = 2048
_RUNTIME_ROOT: Final = Path("/tmp")  # noqa: S108  # nosec B108
"""Short base for sockets, each in a separately checked private directory."""
_PRIVATE_LAN: Final = tuple(
    ipaddress.IPv4Network(cidr) for cidr in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")
)


def signed_executable(bundle: Path) -> Path:
    """Return the listener from a valid, locally signed Medleyplay Share bundle."""
    bundle = bundle.resolve()
    executable = bundle / "Contents" / "MacOS" / SHARE_EXECUTABLE
    if not executable.is_file():
        message = f"Medleyplay Share executable not found: {executable}"
        raise ConfigError(message)
    try:
        subprocess.run(  # noqa: S603  # nosec B603
            [
                "/usr/bin/codesign",
                "--verify",
                "--strict",
                '-R=identifier "org.medleyplay.share"',
                str(bundle),
            ],
            check=True,
            capture_output=True,
            timeout=_START_TIMEOUT,
        )
    except (OSError, subprocess.SubprocessError) as error:
        message = f"Medleyplay Share needs a valid local signature: {bundle}"
        raise ConfigError(message) from error
    return executable


class ShareRequest(BaseModel):
    """Request sent by the local `medleyplay share` command."""

    action: Literal["start", "stop", "status"]
    address: str | None = None
    port: int = Field(default=8000, ge=1, le=MAX_LAN_PORT)


class ShareReply(BaseModel):
    """Result of a sharing command, including an error the CLI can display."""

    message: str
    ok: bool = True


class ShareControl:
    """Own the optional child listener and serve commands on an owner-only Unix socket."""

    def __init__(
        self,
        data_dir: Path,
        executable: Path,
        allowed_hosts: tuple[str, ...],
        set_up: Callable[[], bool] | None = None,
    ) -> None:
        """Use `executable` as the sole process allowed to open the private ingress."""
        self._data_dir = data_dir
        self._executable = executable
        self._allowed = frozenset(allowed_hosts)
        self._setup = set_up
        self._private: str | None = None
        self._process: asyncio.subprocess.Process | None = None
        self._url: str | None = None
        self._lock = asyncio.Lock()
        self._accepting = False

    def address(self) -> str | None:
        """Return the published URL only while the child is running."""
        return self._url if self._process is not None and self._process.returncode is None else None

    def owns_peer(self, transport: asyncio.BaseTransport) -> bool:
        """Check the macOS kernel's peer PID against the running child."""
        process = self._process
        raw = cast("socket.socket | None", transport.get_extra_info("socket"))
        if process is None or process.returncode is not None or raw is None:
            return False
        try:
            pid = raw.getsockopt(_SOL_LOCAL, _LOCAL_PEERPID, 4)
        except OSError:
            return False
        return int.from_bytes(pid, sys.byteorder, signed=True) == process.pid

    @contextlib.contextmanager
    def bind(self, port: int) -> Iterator[tuple[socket.socket, socket.socket, str]]:
        """Bind one loopback browser socket and one private helper socket."""
        with (
            tempfile.TemporaryDirectory(prefix="medleyplay-ingress-", dir=_RUNTIME_ROOT) as work,
            socket.socket(socket.AF_INET, socket.SOCK_STREAM) as local,
            socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as private,
        ):
            path = str(Path(work) / "ingress.sock")
            local.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            local.bind(("127.0.0.1", port))
            private.bind(path)
            Path(path).chmod(0o600)
            self._private = path
            yield local, private, path

    @contextlib.asynccontextmanager
    async def serve(self, set_up: Callable[[], bool] | None = None) -> AsyncIterator[None]:
        """Start the command listener, then close it and stop Share on exit."""
        self._setup = self._setup if set_up is None else set_up
        path = _control_socket(self._data_dir)
        _prepare_control_socket(path)
        server = await asyncio.start_unix_server(self._reply, path, limit=_CONTROL_LIMIT)
        try:
            async with server:
                path.chmod(0o600)
                self._accepting = True
                try:
                    yield
                finally:
                    self._accepting = False
        finally:
            async with self._lock:
                await self._stop()
            with contextlib.suppress(OSError):
                path.parent.rmdir()

    async def _reply(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            try:
                async with asyncio.timeout(_CONTROL_TIMEOUT):
                    request = ShareRequest.model_validate_json(await reader.readline())
            except (TimeoutError, ValidationError, ValueError):
                reply = ShareReply(message="Invalid LAN sharing command.", ok=False)
            else:
                reply = await self._command(request)
            writer.write(reply.model_dump_json().encode() + b"\n")
            await writer.drain()
        except ConnectionError:
            return
        finally:
            writer.close()

    async def _command(self, request: ShareRequest) -> ShareReply:
        async with self._lock:
            if not self._accepting:
                return ShareReply(message="The LAN sharing control is stopping.", ok=False)
            if request.action == "stop":
                await self._stop()
            elif request.action == "start":
                return await self._start(request)
            return ShareReply(message=self.address() or "LAN sharing is off.")

    async def _start(self, request: ShareRequest) -> ShareReply:
        if self.address() is not None:
            return ShareReply(message="Stop LAN sharing before changing its address.", ok=False)
        if self._setup is None or not await asyncio.to_thread(self._setup):
            return ShareReply(
                message="Finish setup on the Mac before enabling LAN sharing.", ok=False
            )
        if not _is_lan_address(request.address, self._allowed):
            return ShareReply(
                message="Use a private IPv4 address in this server's allowed hosts.", ok=False
            )
        return await self._launch(f"{request.address}:{request.port}")

    async def _launch(self, endpoint: str) -> ShareReply:
        if self._private is None:
            return ShareReply(message="The private ingress is not ready.", ok=False)
        try:
            self._process = await asyncio.create_subprocess_exec(
                str(self._executable),
                "-bind",
                endpoint,
                "-private",
                self._private,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
            )
            if self._process.stdout is not None:
                line = await asyncio.wait_for(self._process.stdout.readline(), _START_TIMEOUT)
                if line == endpoint.encode() + b"\n" and self._process.returncode is None:
                    self._url = f"http://{endpoint}"
                    return ShareReply(message=self._url)
        except (OSError, TimeoutError):
            pass
        finally:
            if self._url is None:
                await self._stop()
        return ShareReply(message=f"Could not start Medleyplay Share on {endpoint}.", ok=False)

    async def _stop(self) -> None:
        process = self._process
        self._url = None
        if process is None:
            return
        if process.stdin is not None:
            process.stdin.close()
        try:
            await asyncio.wait_for(process.wait(), _STOP_TIMEOUT)
        except TimeoutError:
            with contextlib.suppress(ProcessLookupError):
                process.kill()
            await process.wait()
        finally:
            self._process = None


def _is_lan_address(address: str | None, allowed: frozenset[str]) -> bool:
    if address is None or address not in allowed:
        return False
    try:
        peer = ipaddress.IPv4Address(address)
    except ValueError:
        return False
    return any(peer in network for network in _PRIVATE_LAN)


def _control_socket(data_dir: Path) -> Path:
    key = hashlib.sha256(os.fsencode(data_dir.resolve())).hexdigest()[:20]
    return _RUNTIME_ROOT / f"medleyplay-share-{os.getuid()}-{key}" / "control.sock"


def _prepare_control_socket(path: Path) -> None:
    path.parent.mkdir(mode=0o700, exist_ok=True)
    info = path.parent.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        message = f"LAN sharing requires a private control directory: {path.parent}"
        raise ConfigError(message)
    with contextlib.suppress(FileNotFoundError):
        info = path.lstat()
        if not stat.S_ISSOCK(info.st_mode) or info.st_uid != os.getuid():
            message = f"LAN sharing will not replace {path}."
            raise ConfigError(message)
        path.unlink()


def share_command(data_dir: Path, request: ShareRequest) -> ShareReply:
    """Send a command to the server for this data folder over its private socket."""
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(_CONTROL_TIMEOUT)
            client.connect(str(_control_socket(data_dir)))
            client.sendall(request.model_dump_json().encode() + b"\n")
            with client.makefile("rb") as stream:
                return ShareReply.model_validate_json(stream.readline(_CONTROL_LIMIT))
    except (OSError, ValidationError) as error:
        message = "Start medleyplay with --share-app before running a LAN sharing command."
        raise ConfigError(message) from error


def run_managed(config: uvicorn.Config, app: ASGIApp, control: ShareControl, port: int) -> None:
    """Run one Uvicorn instance on loopback and on the authenticated helper socket."""

    class PrivateProtocol(H11Protocol):
        @override
        def connection_made(self, transport: asyncio.BaseTransport) -> None:
            super().connection_made(cast("asyncio.Transport", transport))
            raw = cast("socket.socket | None", transport.get_extra_info("socket"))
            if (
                raw is not None
                and raw.family == socket.AF_UNIX
                and not control.owns_peer(transport)
            ):
                transport.close()

    with control.bind(port) as (local, private, path):
        config.app = ShareIngress(app, path)
        config.http = PrivateProtocol
        config.ws = "none"
        uvicorn.Server(config).run(sockets=[local, private])
