import pytest
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.testclient import TestClient
from starlette.types import Receive, Scope, Send

from medleyplay.web.devices import visit_of
from medleyplay.web.share_ingress import ShareIngress


@pytest.mark.parametrize(
    ("private", "reported", "expected"),
    [
        (True, "192.168.4.30", {"host": False, "address": "192.168.4.30", "loopback": False}),
        (True, "127.0.0.1", {"host": False, "address": "127.0.0.1", "loopback": False}),
        (False, "192.168.4.30", {"host": True, "address": "127.0.0.1", "loopback": True}),
    ],
)
def test_ingress_keeps_shared_device_attribution_separate_from_local_privileges(
    reported: str,
    expected: dict[str, str | bool],
    *,
    private: bool,
) -> None:
    async def inspect(scope: Scope, receive: Receive, send: Send) -> None:
        request = Request(scope)
        visit = visit_of(request, None)
        await JSONResponse(
            {
                "host": visit.host,
                "address": visit.address,
                "loopback": request.client is not None and request.client.host == "127.0.0.1",
            }
        )(scope, receive, send)

    wrapped = ShareIngress(inspect, "/test/share.sock")

    async def connect(scope: Scope, receive: Receive, send: Send) -> None:
        if private:
            scope = {**scope, "server": ("/test/share.sock", None), "client": None}
        await wrapped(scope, receive, send)

    browser = TestClient(connect, client=("127.0.0.1", 50001))
    answer = browser.get("/", headers={"X-Medleyplay-Share-Peer": reported})

    assert answer.json() == expected


def test_a_request_on_the_private_ingress_requires_an_observed_ip() -> None:
    async def not_called(scope: Scope, receive: Receive, send: Send) -> None:
        pytest.fail("A shared HTTP request with no observed peer reached the app")

    wrapped = ShareIngress(not_called, "/test/share.sock")

    async def connect(scope: Scope, receive: Receive, send: Send) -> None:
        await wrapped({**scope, "server": ("/test/share.sock", None)}, receive, send)

    client = TestClient(connect)

    assert client.get("/").status_code == 400
