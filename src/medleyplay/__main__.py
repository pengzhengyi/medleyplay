"""Command-line entry point: `python -m medleyplay`."""

import argparse
import dataclasses
import getpass
import shlex
import sys
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import TYPE_CHECKING, Final

from medleyplay import __version__
from medleyplay.application.devices import DevicesView
from medleyplay.config import CONFIG_FILE, ConfigError, load_config
from medleyplay.domain.devices import Admission
from medleyplay.domain.errors import MedleyplayError
from medleyplay.persistence.data_folder import DataMoveError, move_data_folder
from medleyplay.persistence.database import database_path
from medleyplay.server import (
    DATA_DIR_VARIABLE,
    DEFAULT_PORT,
    INSTANCE_LOCK,
    AlreadyRunningError,
    Settings,
    build_app,
    build_services,
    default_data_dir,
    environment,
    former_data_dir,
    hold_instance_lock,
    open_database,
)

if TYPE_CHECKING:
    import uvicorn
    from starlette.types import ASGIApp

type ReadPassword = Callable[[str], str]
type Ask = Callable[[str], str]

SHUTDOWN_GRACE_SECONDS: Final = 5
"""How long a stopping server waits for open requests, such as a page's event stream, to end."""

_CHOICES: Final = {
    "ask-first": Admission.ASK,
    "allow-all": Admission.EVERYONE,
    "block-new-devices": Admission.KNOWN,
}
"""Each choice for new devices as the command line names it, in the page's own words."""
_SHOWN: Final = {
    Admission.ASK: "Ask first",
    Admission.EVERYONE: "Allow all",
    Admission.KNOWN: "Block new devices",
}
_TUNNEL: Final = (
    "open the page on this computer through an SSH tunnel: "
    "ssh -L 8000:localhost:8000 <this computer>, then http://localhost:8000"
)


def main(
    argv: Sequence[str] | None = None,
    *,
    serve: Callable[[Settings, str, int], None] | None = None,
    read_password: ReadPassword = getpass.getpass,
    ask: Ask = input,
    interactive: Callable[[], bool] = sys.stdin.isatty,
    platform: str = sys.platform,
) -> int:
    """Parse the command line, run the command, and return the process exit code."""
    parser = _parser()
    args = parser.parse_args(argv)
    settings = Settings.from_environment(environment(), platform)
    if getattr(args, "data_dir", None) is not None:
        settings = dataclasses.replace(settings, data_dir=args.data_dir, data_dir_chosen=True)
    try:
        match args.command:
            case "serve":
                settings = _data_to_serve(settings, platform, ask, interactive=interactive())
                settings = dataclasses.replace(settings, safe_mode=args.safe_mode)
                settings, host = _listen_settings(settings, args.host, args.share_app, platform)
                (serve or _run_server)(settings, host, args.port)
            case "share":
                return _share(settings, args, platform)
            case "reset-password":
                return _reset_password(settings, args.username, read_password)
            case "devices":
                return _devices(settings, args.choice)
            case "move-data":
                return _move_data_command(settings, args.to, platform)
    except ConfigError as error:
        sys.stderr.write(f"{error}\n")
        return 1
    return 0


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="medleyplay",
        description="Play music on your local network.",
    )
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    # Each command takes the data folder, so it may follow the command's name.
    folder = argparse.ArgumentParser(add_help=False)
    folder.add_argument(
        "--data-dir",
        type=Path,
        help=f"the data folder, instead of ${DATA_DIR_VARIABLE} or the default",
    )
    commands = parser.add_subparsers(dest="command")
    serve = commands.add_parser("serve", help="run the server", parents=[folder])
    serve.add_argument("--host", help="address to listen on (all interfaces by default)")
    serve.add_argument("--port", type=int, default=DEFAULT_PORT, help="port to listen on")
    serve.add_argument(
        "--share-app", type=Path, help="use a locally signed Medleyplay Share.app (macOS pilot)"
    )
    serve.add_argument(
        "--safe-mode", action="store_true", help="start with every plugin off, for this run"
    )
    reset = commands.add_parser(
        "reset-password",
        help="set an Account's password and sign it out everywhere",
        parents=[folder],
    )
    reset.add_argument("username")
    devices = commands.add_parser(
        "devices",
        parents=[folder],
        help="list the allowed devices, or choose what happens to new ones",
        description=(
            "List the devices allowed to reach the server, or choose what happens to new "
            "ones, while the server is stopped. To answer devices while it runs, "
            f"{_TUNNEL}. A service manager that restarts the server must stop it first."
        ),
    )
    devices.set_defaults(choice=None)
    actions = devices.add_subparsers(dest="action")
    choose = actions.add_parser("choose", help="choose what happens to new devices")
    choose.add_argument("choice", choices=_CHOICES)
    move = commands.add_parser(
        "move-data",
        parents=[folder],
        help="move the data folder elsewhere, while the server is stopped",
        description=(
            "Copy the data folder to a new or empty folder, check the copy, then delete the "
            "old one. With no folder given, it moves to the default one."
        ),
    )
    move.add_argument("to", type=Path, nargs="?", help="where to move it")
    sharing = commands.add_parser(
        "share", help="control the Mac LAN sharing pilot", parents=[folder]
    )
    share_actions = sharing.add_subparsers(dest="action", required=True)
    start = share_actions.add_parser("start", help="start sharing on the given Mac LAN address")
    start.add_argument("address", help="private IPv4 address of the Mac")
    start.add_argument("--port", type=int, default=DEFAULT_PORT, help="LAN port to listen on")
    share_actions.add_parser("status", help="show the LAN URL or whether sharing is off")
    share_actions.add_parser("stop", help="stop sharing without stopping the Mac browser")
    return parser


def server_config(app: "ASGIApp", host: str, port: int) -> "uvicorn.Config":
    """How `serve` runs `app`: on `host` and `port`, closing what is still open once stopped."""
    import uvicorn  # noqa: PLC0415 -- only `serve` needs the server

    # Forwarding headers never stand in for the peer: the device check trusts only the connection.
    # A page's event stream never ends on its own, so a stopping server would wait for it forever.
    return uvicorn.Config(
        app,
        host=host,
        port=port,
        proxy_headers=False,
        timeout_graceful_shutdown=SHUTDOWN_GRACE_SECONDS,
    )


def _run_server(settings: Settings, host: str, port: int) -> None:  # pragma: no cover
    import uvicorn  # noqa: PLC0415 -- only `serve` needs the server

    if settings.share_app is None:
        uvicorn.Server(server_config(build_app(settings), host, port)).run()
        return
    _run_managed(settings, host, port, settings.share_app)


def _listen_settings(
    settings: Settings,
    host: str | None,
    share_app: Path | None,
    platform: str,
) -> tuple[Settings, str]:
    if share_app is None:
        return settings, host if host is not None else "0.0.0.0"  # noqa: S104  # nosec B104
    _require_mac_sharing(platform)
    if host not in {None, "127.0.0.1"}:
        message = "--share-app requires a private host listener at 127.0.0.1."
        raise ConfigError(message)
    return dataclasses.replace(settings, share_app=share_app), "127.0.0.1"


def _require_mac_sharing(platform: str) -> None:
    if platform != "darwin":
        message = "The LAN sharing pilot runs only on macOS."
        raise ConfigError(message)


def _run_managed(
    settings: Settings, host: str, port: int, share_app: Path
) -> None:  # pragma: no cover
    from medleyplay.lan_sharing import (  # noqa: PLC0415 -- macOS pilot only
        ShareControl,
        run_managed,
        signed_executable,
    )

    executable = signed_executable(share_app)
    control = ShareControl(settings.data_dir, executable, settings.allowed_hosts)
    app = build_app(settings, sharing=control)
    run_managed(server_config(app, host, port), app, control, port)


def _share(settings: Settings, args: argparse.Namespace, platform: str) -> int:
    from medleyplay.lan_sharing import (  # noqa: PLC0415 -- CLI only
        MAX_LAN_PORT,
        ShareRequest,
        share_command,
    )

    _require_mac_sharing(platform)
    port = getattr(args, "port", DEFAULT_PORT)
    if not 1 <= port <= MAX_LAN_PORT:
        message = f"The LAN port must be between 1 and {MAX_LAN_PORT}."
        raise ConfigError(message)
    data_dir = _former_with_data(settings, platform) or settings.data_dir
    reply = share_command(
        data_dir,
        ShareRequest(action=args.action, address=getattr(args, "address", None), port=port),
    )
    (sys.stdout if reply.ok else sys.stderr).write(f"{reply.message}\n")
    return 0 if reply.ok else 1


def _former_with_data(settings: Settings, platform: str) -> Path | None:
    """Return where the data was kept before, when it is still there and none is here."""
    former = former_data_dir(platform)
    if (
        settings.data_dir_chosen
        or former is None
        or database_path(settings.data_dir).exists()
        or not database_path(former).exists()
    ):
        return None
    return former


def _data_to_serve(settings: Settings, platform: str, ask: Ask, *, interactive: bool) -> Settings:
    """Return the settings to serve with, once asked to move data still where it was before.

    Unless the move is made, the server uses the data where it is.
    """
    former = _former_with_data(settings, platform)
    if former is None:
        return settings
    kept = dataclasses.replace(settings, data_dir=former)
    if not interactive:
        sys.stderr.write(
            f"medleyplay's data is still in {former}, and is used from there. To move it to "
            f"{settings.data_dir}, stop the server and run: medleyplay move-data\n"
        )
        return kept
    reply = ask(
        f"medleyplay now keeps its data in {settings.data_dir}; yours is in {former}.\n"
        "Move it there? [Y/n] "
    )
    if reply.strip().lower() not in {"", "y", "yes"}:
        sys.stdout.write(
            f"Kept it in {former}. To stop this question, set "
            f"{DATA_DIR_VARIABLE}={shlex.quote(str(former))}; "
            "to move it later, run: medleyplay move-data\n"
        )
        return kept
    return settings if _move(former, settings.data_dir) else kept


def _move_data_command(settings: Settings, to: Path | None, platform: str) -> int:
    """Move the data `serve` would use to `to`, by default the platform's default folder."""
    source = _former_with_data(settings, platform) or settings.data_dir
    default = default_data_dir(environment(), platform)
    target = default if to is None else to
    if source.resolve() == target.resolve():
        sys.stdout.write(f"medleyplay's data is already in {target}.\n")
        return 0
    if not _move(source, target):
        return 1
    if target.resolve() != default.resolve():
        quoted = shlex.quote(str(target))
        sys.stdout.write(
            f"Start medleyplay with --data-dir {quoted}, or set {DATA_DIR_VARIABLE}={quoted}.\n"
        )
    elif environment().get(DATA_DIR_VARIABLE):
        sys.stdout.write(f"Remove {DATA_DIR_VARIABLE}, so medleyplay uses {target}.\n")
    return 0


def _move(source: Path, target: Path) -> bool:
    """Move the data folder `source` to `target`, saying how it went; return whether it moved."""
    if not database_path(source).exists():
        sys.stderr.write(f"No medleyplay database in {source}; nothing was moved.\n")
        return False
    try:
        with hold_instance_lock(source):
            moved = move_data_folder(source, target, leave={INSTANCE_LOCK})
    except AlreadyRunningError:
        sys.stderr.write(f"medleyplay is running on {source}. Stop it first.\n")
        return False
    except DataMoveError as error:
        sys.stderr.write(f"{error}\n")
        return False
    sys.stdout.write(
        f"Moved medleyplay's data to {target} ({moved.files} files, "
        f"{moved.size / 1_000_000:.1f} MB) and deleted {source}.\n"
    )
    return True


def _reset_password(settings: Settings, username: str, read_password: ReadPassword) -> int:
    password = read_password("New password: ")
    if read_password("Repeat it: ") != password:
        sys.stderr.write("The passwords don't match; nothing changed.\n")
        return 1
    config = load_config(settings.data_dir / CONFIG_FILE)
    engine = open_database(settings.data_dir)
    try:
        build_services(engine, settings.data_dir, config=config).accounts.reset_password(
            username, password
        )
    except MedleyplayError as error:
        sys.stderr.write(f"{error}\n")
        return 1
    finally:
        engine.dispose()
    sys.stdout.write(f"Changed the password of {username!r} and signed it out everywhere.\n")
    return 0


def _devices(settings: Settings, choice: str | None) -> int:
    """List the devices, or make `choice` for new ones, while no server uses the data folder."""
    data_dir = settings.data_dir
    if not database_path(data_dir).exists():
        sys.stderr.write(
            f"No medleyplay database in {data_dir}; set MEDLEYPLAY_DATA_DIR to the server's.\n"
        )
        return 1
    try:
        with hold_instance_lock(data_dir):
            engine = open_database(data_dir)
            try:
                devices = build_services(engine, data_dir).devices
                view = (
                    devices.terminal_view()
                    if choice is None
                    else devices.terminal_choose(_CHOICES[choice])
                )
            finally:
                engine.dispose()
    except AlreadyRunningError:
        sys.stderr.write(f"medleyplay is running on {data_dir}. Stop it first, or {_TUNNEL}.\n")
        return 1
    sys.stdout.write(_listed(data_dir, view))
    if choice is not None and view.admission is Admission.EVERYONE:
        sys.stdout.write(
            "Anyone on this network can reach the sign-in form until an admin chooses "
            "Ask first in Settings.\n"
        )
    return 0


def _listed(data_dir: Path, view: DevicesView) -> str:
    lines = [f"Data folder: {data_dir}", f"New devices: {_SHOWN[view.admission]}"]
    if not view.allowed:
        lines.append("No devices allowed.")
    else:
        lines.append("Allowed devices:")
        lines.extend(
            f"  {device.id}  "
            + (device.label if device.name is None else f"{device.name} ({device.label})")
            + f", {device.address}, last seen {device.last_seen_at:%Y-%m-%d %H:%M} UTC"
            for device in view.allowed
        )
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    raise SystemExit(main())
