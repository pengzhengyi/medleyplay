"""Command-line entry point: `python -m medleyplay`."""

import argparse
import dataclasses
import getpass
import sys
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Final

from medleyplay import __version__
from medleyplay.application.devices import DevicesView
from medleyplay.config import CONFIG_FILE, ConfigError, load_config
from medleyplay.domain.devices import Admission
from medleyplay.domain.errors import MedleyplayError
from medleyplay.persistence.database import database_path
from medleyplay.server import (
    DEFAULT_PORT,
    AlreadyRunningError,
    Settings,
    build_app,
    build_services,
    environment,
    hold_instance_lock,
    open_database,
)

type ReadPassword = Callable[[str], str]

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
) -> int:
    """Parse the command line, run the command, and return the process exit code."""
    parser = _parser()
    args = parser.parse_args(argv)
    settings = Settings.from_environment(environment())
    try:
        match args.command:
            case "serve":
                settings = dataclasses.replace(settings, safe_mode=args.safe_mode)
                (serve or _run_server)(settings, args.host, args.port)
            case "reset-password":
                return _reset_password(settings, args.username, read_password)
            case "devices":
                return _devices(settings, args.choice)
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
    commands = parser.add_subparsers(dest="command")
    serve = commands.add_parser("serve", help="run the server")
    # Every interface by default: devices on the LAN must reach it.
    serve.add_argument("--host", default="0.0.0.0", help="address to listen on")  # noqa: S104  # nosec B104
    serve.add_argument("--port", type=int, default=DEFAULT_PORT, help="port to listen on")
    serve.add_argument(
        "--safe-mode", action="store_true", help="start with every plugin off, for this run"
    )
    reset = commands.add_parser(
        "reset-password", help="set an Account's password and sign it out everywhere"
    )
    reset.add_argument("username")
    devices = commands.add_parser(
        "devices",
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
    return parser


def _run_server(settings: Settings, host: str, port: int) -> None:  # pragma: no cover
    import uvicorn  # noqa: PLC0415 -- only `serve` needs the server

    # Forwarding headers never stand in for the peer: the device check trusts only the connection.
    uvicorn.run(build_app(settings), host=host, port=port, proxy_headers=False)


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
