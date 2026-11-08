"""The command line: `python -m medleyplay`."""

import asyncio
import re
import runpy
import socket
import sys
import threading
import time
from collections.abc import Iterator
from importlib.metadata import version
from pathlib import Path

import pytest
import uvicorn
from starlette.types import Receive, Scope, Send

from medleyplay.__main__ import SHUTDOWN_GRACE_SECONDS, main, server_config
from medleyplay.application.devices import Visit
from medleyplay.domain.devices import Admission
from medleyplay.server import (
    Settings,
    build_app,
    build_services,
    hold_instance_lock,
    open_database,
)
from tests.support.factories import PASSWORD, NewAccountFactory


def test_version_flag_prints_the_installed_package_version(
    capsys: pytest.CaptureFixture[str],
) -> None:
    with pytest.raises(SystemExit) as exit_info:
        main(["--version"])

    assert exit_info.value.code == 0
    output = capsys.readouterr().out
    assert output == f"medleyplay {version('medleyplay')}\n"
    assert re.fullmatch(r"medleyplay \d+\.\d+\.\d+\S*\n", output)


def test_running_the_module_with_version_exits_successfully(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setattr(sys, "argv", ["medleyplay", "--version"])
    # runpy warns when the module it is about to execute is already imported.
    monkeypatch.delitem(sys.modules, "medleyplay.__main__")

    with pytest.raises(SystemExit) as exit_info:
        runpy.run_module("medleyplay", run_name="__main__")

    assert exit_info.value.code == 0
    assert capsys.readouterr().out.startswith("medleyplay ")


@pytest.mark.usefixtures("data_dir")
def test_no_arguments_exits_successfully() -> None:
    assert main([]) == 0


@pytest.fixture
def data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("MEDLEYPLAY_DATA_DIR", str(tmp_path))
    return tmp_path


def _answers(*answers: str) -> Iterator[str]:
    return iter(answers)


def _household_with_alice(data_dir: Path) -> None:
    """Create Alice, the first admin, in the database in `data_dir`."""
    engine = open_database(data_dir)
    build_services(engine, data_dir).accounts.create_first_admin(NewAccountFactory.admin())
    engine.dispose()


def test_serve_starts_the_server_on_the_requested_address(data_dir: Path) -> None:
    started: list[tuple[Settings, str, int]] = []

    exit_code = main(
        ["serve", "--host", "127.0.0.1", "--port", "8123"],
        serve=lambda settings, host, port: started.append((settings, host, port)),
    )

    assert exit_code == 0
    [(settings, host, port)] = started
    assert (settings.data_dir, host, port) == (data_dir, "127.0.0.1", 8123)


@pytest.mark.usefixtures("data_dir")
def test_serve_listens_on_every_interface_at_port_8000_by_default() -> None:
    started: list[tuple[str, int]] = []

    main(["serve"], serve=lambda _, host, port: started.append((host, port)))

    assert started == [("0.0.0.0", 8000)]  # noqa: S104 -- the default under test


@pytest.mark.parametrize(("arguments", "safe_mode"), [([], False), (["--safe-mode"], True)])
@pytest.mark.usefixtures("data_dir")
def test_serve_starts_in_safe_mode_only_when_asked(
    arguments: list[str], *, safe_mode: bool
) -> None:
    started: list[Settings] = []

    main(["serve", *arguments], serve=lambda settings, _, __: started.append(settings))

    assert [settings.safe_mode for settings in started] == [safe_mode]


def _build_only(settings: Settings, host: str, port: int) -> None:
    """Build the app as `serve` does, without listening."""
    build_app(settings)


async def _endless_stream(scope: Scope, _: Receive, send: Send) -> None:
    """Answer every request with an event stream that never ends, as a page's `/api/events`."""
    if scope["type"] != "http":
        return
    headers = [(b"content-type", b"text/event-stream")]
    await send({"type": "http.response.start", "status": 200, "headers": headers})
    while True:
        await send({"type": "http.response.body", "body": b": still here\n\n", "more_body": True})
        await asyncio.sleep(0.1)


def test_a_stopping_server_closes_an_open_event_stream_rather_than_wait_for_it() -> None:
    listener = socket.create_server(("127.0.0.1", 0))
    server = uvicorn.Server(server_config(_endless_stream, "127.0.0.1", 0))
    running = threading.Thread(target=server.run, kwargs={"sockets": [listener]}, daemon=True)
    running.start()
    while not server.started:
        time.sleep(0.01)
    page = socket.create_connection(listener.getsockname())
    page.sendall(b"GET /api/events HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
    assert page.recv(1024).startswith(b"HTTP/1.1 200")

    stopped_at = time.monotonic()
    server.should_exit = True
    running.join(timeout=SHUTDOWN_GRACE_SECONDS + 5)

    page.close()
    assert not running.is_alive()
    assert time.monotonic() - stopped_at < SHUTDOWN_GRACE_SECONDS + 2


def test_serve_with_an_invalid_config_file_fails_with_the_reason(
    data_dir: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    (data_dir / "medleyplay.toml").write_text("multiple_accounts = = 1", encoding="utf-8")

    exit_code = main(["serve"], serve=_build_only)

    assert exit_code == 1
    assert "isn't valid TOML" in capsys.readouterr().err


def test_reset_password_sets_the_new_password(
    data_dir: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    _household_with_alice(data_dir)
    answers = _answers("a brand new password", "a brand new password")

    exit_code = main(["reset-password", "alice"], read_password=lambda _: next(answers))

    assert exit_code == 0
    assert "signed it out everywhere" in capsys.readouterr().out
    engine = open_database(data_dir)
    signed_in = build_services(engine, data_dir).accounts.sign_in("alice", "a brand new password")
    engine.dispose()
    assert signed_in.account.username == "alice"


def test_reset_password_changes_nothing_when_the_repeat_differs(
    data_dir: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    _household_with_alice(data_dir)
    answers = _answers("a brand new password", "a different password")

    exit_code = main(["reset-password", "alice"], read_password=lambda _: next(answers))

    assert exit_code == 1
    assert "don't match" in capsys.readouterr().err
    engine = open_database(data_dir)
    assert (
        build_services(engine, data_dir).accounts.sign_in("alice", PASSWORD).account.username
        == "alice"
    )
    engine.dispose()


@pytest.mark.usefixtures("data_dir")
def test_reset_password_for_an_unknown_username_fails_with_the_reason(
    capsys: pytest.CaptureFixture[str],
) -> None:
    answers = _answers("a brand new password", "a brand new password")

    exit_code = main(["reset-password", "nobody"], read_password=lambda _: next(answers))

    assert exit_code == 1
    assert "'nobody'" in capsys.readouterr().err


SAFARI_ON_IPHONE = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15"
    " (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1"
)


def _household_with_a_named_phone(data_dir: Path) -> None:
    """Alice's household, asking first, with one phone allowed and named "Mia's phone"."""
    engine = open_database(data_dir)
    services = build_services(engine, data_dir)
    alice = services.accounts.create_first_admin(NewAccountFactory.admin()).account
    devices = services.devices
    devices.ask(Visit(None, "192.168.1.23", host=False), SAFARI_ON_IPHONE, session_token=None)
    phone = devices.allow(alice, devices.devices(alice).waiting[0].id)
    devices.rename(alice, phone.id, "Mia's phone")
    engine.dispose()


def _admission_in(data_dir: Path) -> Admission:
    engine = open_database(data_dir)
    try:
        return build_services(engine, data_dir).devices.terminal_view().admission
    finally:
        engine.dispose()


def test_devices_lists_the_choice_and_each_allowed_device(
    data_dir: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    _household_with_a_named_phone(data_dir)

    exit_code = main(["devices"])

    lines = capsys.readouterr().out.splitlines()
    assert exit_code == 0
    assert lines[:2] == [f"Data folder: {data_dir}", "New devices: Ask first"]
    assert "Mia's phone (Safari on iPhone), 192.168.1.23" in lines[3]


def test_devices_choose_allow_all_lets_new_devices_in_and_says_who_can_reach_sign_in(
    data_dir: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    _household_with_a_named_phone(data_dir)

    exit_code = main(["devices", "choose", "allow-all"])

    assert exit_code == 0
    assert _admission_in(data_dir) is Admission.EVERYONE
    assert "Anyone on this network can reach the sign-in form" in capsys.readouterr().out


def test_devices_refuses_while_a_server_uses_the_data_folder(
    data_dir: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    _household_with_a_named_phone(data_dir)

    with hold_instance_lock(data_dir):
        exit_code = main(["devices", "choose", "allow-all"])

    assert exit_code == 1
    assert "ssh -L" in capsys.readouterr().err
    assert _admission_in(data_dir) is Admission.ASK


def test_devices_refuses_a_data_folder_with_no_database(
    data_dir: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    exit_code = main(["devices"])

    assert exit_code == 1
    assert str(data_dir) in capsys.readouterr().err
    assert list(data_dir.iterdir()) == []
