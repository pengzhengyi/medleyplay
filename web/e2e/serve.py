"""Start a medleyplay server for the end-to-end tests, over a fresh data folder and music.

The music is silent WAV files named for their Tracks: `Alpha`, `Bravo`, and
`Charlie` in a folder, and `Delta` compressed in a zip archive, so it must be
prepared before it plays. Run from `web/` with `uv run --project .. python e2e/serve.py`.

The Mode's connectivity check asks a small server on this machine, so a run reaches
no site.
"""

import http.server
import shutil
import threading
import wave
import zipfile
from pathlib import Path

import uvicorn

from medleyplay.server import PluginSource, Settings, build_app

PORT = 4174
HERE = Path(__file__).resolve().parent
ROOT = HERE.parent / ".cache" / "e2e"
RATE = 8000


def silence(path: Path, seconds: int) -> None:
    """Write `seconds` of 8 kHz, 8-bit, mono silence to `path`."""
    with wave.open(str(path), "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(1)
        audio.setframerate(RATE)
        audio.writeframes(b"\x80" * RATE * seconds)


class _NoContent(http.server.BaseHTTPRequestHandler):
    """Answers every request with 204, as a connectivity check expects."""

    def do_GET(self) -> None:
        self.send_response(204)
        self.end_headers()

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002 -- the signature it overrides
        """Keep the server's output for the tests."""


def local_check() -> str:
    """Start a server on this machine for the Mode's check, and return its URL."""
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _NoContent)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{server.server_port}/generate_204"


def serve(data_dir: Path, port: int, source: PluginSource = PluginSource()) -> None:  # noqa: B008 -- a frozen value
    """Run a server on `port` over `data_dir`, with the plugins in `source`."""
    data_dir.mkdir(parents=True, exist_ok=True)
    config = f'[[mode.checks]]\nurl = "{local_check()}"\nstatus = 204\n'
    (data_dir / "medleyplay.toml").write_text(config, encoding="utf-8")
    settings = Settings(data_dir=data_dir, allowed_hosts=("127.0.0.1", "localhost"))
    uvicorn.run(build_app(settings, source), host="127.0.0.1", port=port)


def main() -> None:
    """Make the music and the data folder, then become the server."""
    shutil.rmtree(ROOT, ignore_errors=True)
    music = ROOT / "Music"
    music.mkdir(parents=True)
    silence(music / "Alpha.wav", 60)
    silence(music / "Bravo.wav", 60)
    silence(music / "Charlie.wav", 2)
    silence(ROOT / "Delta.wav", 60)
    with zipfile.ZipFile(ROOT / "Old Mixes.zip", "w", zipfile.ZIP_DEFLATED) as archive:
        archive.write(ROOT / "Delta.wav", "Delta.wav")
    (ROOT / "Delta.wav").unlink()
    serve(ROOT / "data", PORT)


if __name__ == "__main__":
    main()
