import asyncio
from pathlib import Path

from medleyplay.lan_sharing import ShareControl, ShareRequest, share_command


def test_share_control_does_not_start_before_local_account_setup(tmp_path: Path) -> None:
    async def exercise() -> str:
        control = ShareControl(tmp_path, tmp_path / "unused", ("192.168.4.30",), lambda: False)
        async with control.serve():
            reply = await asyncio.to_thread(
                share_command, tmp_path, ShareRequest(action="start", address="192.168.4.30")
            )
            assert not reply.ok
            return reply.message

    assert asyncio.run(exercise()) == "Finish setup on the Mac before enabling LAN sharing."


def test_share_control_starts_off_and_does_not_accept_an_unlisted_network_address(
    tmp_path: Path,
) -> None:
    async def exercise() -> tuple[str, str, str]:
        control = ShareControl(tmp_path, tmp_path / "unused", ("192.168.4.30",), lambda: True)
        async with control.serve():
            status = await asyncio.to_thread(share_command, tmp_path, ShareRequest(action="status"))
            start = await asyncio.to_thread(
                share_command, tmp_path, ShareRequest(action="start", address="192.168.9.9")
            )
            again = await asyncio.to_thread(share_command, tmp_path, ShareRequest(action="status"))
            assert status.ok
            assert not start.ok
            assert again.ok
            return status.message, start.message, again.message

    assert asyncio.run(exercise()) == (
        "LAN sharing is off.",
        "Use a private IPv4 address in this server's allowed hosts.",
        "LAN sharing is off.",
    )


def test_a_failed_helper_start_does_not_publish_a_url(tmp_path: Path) -> None:
    async def exercise() -> str | None:
        control = ShareControl(tmp_path, tmp_path / "missing", ("192.168.4.30",), lambda: True)
        with control.bind(0):
            async with control.serve():
                started = await asyncio.to_thread(
                    share_command, tmp_path, ShareRequest(action="start", address="192.168.4.30")
                )
                assert not started.ok
                assert "Could not start" in started.message
                return control.address()

    assert asyncio.run(exercise()) is None
