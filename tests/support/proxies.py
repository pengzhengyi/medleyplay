"""Proxies on 127.0.0.1 that record what they are asked and answer as a test says.

Neither proxy connects anywhere: an HTTP proxy answers every request itself, and
refuses every tunnel; a SOCKS proxy refuses every connection. So a test can show
that a request went through a proxy, and what it asked for, without any site
being contacted.
"""

import base64
import http.server
import socketserver
import struct
import threading
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Final

LOOPBACK: Final = "127.0.0.1"


@dataclass(frozen=True)
class Answer:
    """An HTTP answer: a status, headers such as `Location`, and a body."""

    status: int
    headers: Mapping[str, str] = field(default_factory=dict)
    body: bytes = b""


PRECONDITION_FAILED: Final = Answer(412)
"""Bilibili's answer to a client it suspects."""


class HttpProxy:
    """An HTTP proxy that records each request line and answers from a table.

    A `GET` is answered with `answers[url]`, or `otherwise`; a `CONNECT` is
    always refused with 403, so no tunnel to a site is ever opened.
    """

    def __init__(self, answers: Mapping[str, Answer], otherwise: Answer) -> None:
        self.answers = answers
        self.otherwise = otherwise
        self.requests: list[str] = []
        """Each request line as received, such as `GET http://b23.tv/abc HTTP/1.1`."""
        self.authorizations: list[str | None] = []
        """Each request's `Proxy-Authorization` header."""
        self.port = 0

    @property
    def url(self) -> str:
        """Return the proxy's URL, `http://127.0.0.1:<port>`."""
        return f"http://{LOOPBACK}:{self.port}"

    def url_with_login(self, user: str, password: str) -> str:
        """Return the proxy's URL with a login."""
        return f"http://{user}:{password}@{LOOPBACK}:{self.port}"

    def basic_login(self, user: str, password: str) -> str:
        """Return the `Proxy-Authorization` header a client sends for the login."""
        return "Basic " + base64.b64encode(f"{user}:{password}".encode()).decode("ascii")


class _HttpHandler(http.server.BaseHTTPRequestHandler):
    server: "_HttpServer"

    def _record(self) -> HttpProxy:
        proxy = self.server.proxy
        proxy.requests.append(self.requestline)
        proxy.authorizations.append(self.headers.get("Proxy-Authorization"))
        return proxy

    def do_GET(self) -> None:
        proxy = self._record()
        answer = proxy.answers.get(self.path, proxy.otherwise)
        self.send_response(answer.status)
        for name, value in answer.headers.items():
            self.send_header(name, value)
        self.send_header("Content-Length", str(len(answer.body)))
        self.end_headers()
        if self.command == "GET":
            self.wfile.write(answer.body)

    do_HEAD = do_GET  # noqa: N815 -- the name http.server looks up

    def do_CONNECT(self) -> None:
        self._record()
        self.send_response(403)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, *_: object) -> None:
        pass


class _HttpServer(http.server.ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, proxy: HttpProxy) -> None:
        super().__init__((LOOPBACK, 0), _HttpHandler)
        self.proxy = proxy


@contextmanager
def running_http_proxy(
    answers: Mapping[str, Answer] | None = None, otherwise: Answer = PRECONDITION_FAILED
) -> Iterator[HttpProxy]:
    """Run an HTTP proxy that answers `answers` by URL, and `otherwise` to any other."""
    proxy = HttpProxy(answers or {}, otherwise)
    server = _HttpServer(proxy)
    proxy.port = server.server_port
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        yield proxy
    finally:
        server.shutdown()
        server.server_close()


class SocksProxy:
    """A SOCKS5 proxy that records the host and port of each connection it is asked for."""

    def __init__(self) -> None:
        self.asked: list[str] = []
        """Each destination as the client named it, such as `www.bilibili.com:443`."""
        self.port = 0

    @property
    def url(self) -> str:
        """Return the proxy's URL, `socks5h://127.0.0.1:<port>`."""
        return f"socks5h://{LOOPBACK}:{self.port}"


class _SocksHandler(socketserver.BaseRequestHandler):
    server: "_SocksServer"

    def handle(self) -> None:
        _version, count = struct.unpack("!BB", self._read(2))
        self._read(count)
        self.request.sendall(b"\x05\x00")
        _version, _command, _reserved, kind = struct.unpack("!BBBB", self._read(4))
        if kind == 3:  # a name, which socks5h leaves to the proxy
            host = self._read(self._read(1)[0]).decode("ascii")
        else:
            host = ".".join(str(byte) for byte in self._read(4))
        (port,) = struct.unpack("!H", self._read(2))
        self.server.proxy.asked.append(f"{host}:{port}")
        self.request.sendall(b"\x05\x05\x00\x01\x00\x00\x00\x00\x00\x00")  # connection refused

    def _read(self, count: int) -> bytes:
        data = b""
        while len(data) < count:
            chunk = self.request.recv(count - len(data))
            if not chunk:
                raise ConnectionError
            data += chunk
        return data


class _SocksServer(socketserver.ThreadingTCPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, proxy: SocksProxy) -> None:
        super().__init__((LOOPBACK, 0), _SocksHandler)
        self.proxy = proxy


@contextmanager
def running_socks_proxy() -> Iterator[SocksProxy]:
    """Run a SOCKS5 proxy that refuses every connection after recording where to."""
    proxy = SocksProxy()
    server = _SocksServer(proxy)
    proxy.port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        yield proxy
    finally:
        server.shutdown()
        server.server_close()
