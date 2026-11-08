"""The FastAPI app: its routers, domain errors as HTTP statuses, and the request checks."""

from collections.abc import Awaitable, Callable, Iterable
from contextlib import AbstractAsyncContextManager
from pathlib import Path
from typing import Final
from urllib.parse import urlsplit

from fastapi import FastAPI, Request, Response, status
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware

from medleyplay import __version__
from medleyplay.domain.errors import (
    BusyError,
    ConflictError,
    ForbiddenError,
    InvalidInputError,
    KeychainUnavailableError,
    MedleyplayError,
    NotFoundError,
    NotSignedInError,
    PluginCallError,
    PluginUnavailableError,
    SignInRefusedError,
    SignInThrottledError,
    TooLargeError,
)
from medleyplay.web import (
    accounts,
    addresses,
    ai,
    catalog,
    covers,
    details,
    devices,
    downloads,
    enrichers,
    events,
    jobs,
    libraries,
    linked_accounts,
    links,
    mode,
    playback,
    plugins,
    preferences,
    proxies,
    ratings,
    remote,
    settings,
    songs,
    storage,
)
from medleyplay.web.deps import Services
from medleyplay.web.pages import CLIENT_DIR, client_app

_STATUS_OF: Final[tuple[tuple[type[MedleyplayError], int], ...]] = (
    (InvalidInputError, status.HTTP_422_UNPROCESSABLE_CONTENT),
    (NotFoundError, status.HTTP_404_NOT_FOUND),
    (ConflictError, status.HTTP_409_CONFLICT),
    (TooLargeError, status.HTTP_413_CONTENT_TOO_LARGE),
    (ForbiddenError, status.HTTP_403_FORBIDDEN),
    (NotSignedInError, status.HTTP_401_UNAUTHORIZED),
    (SignInRefusedError, status.HTTP_401_UNAUTHORIZED),
    (SignInThrottledError, status.HTTP_429_TOO_MANY_REQUESTS),
    (BusyError, status.HTTP_429_TOO_MANY_REQUESTS),
    (PluginUnavailableError, status.HTTP_503_SERVICE_UNAVAILABLE),
    (KeychainUnavailableError, status.HTTP_503_SERVICE_UNAVAILABLE),
    (PluginCallError, status.HTTP_502_BAD_GATEWAY),
)
_DETAIL_OF: Final[dict[type[MedleyplayError], str]] = {
    NotSignedInError: "Sign in first.",
    SignInRefusedError: "The username or password is wrong.",
}
_SAFE_METHODS: Final = frozenset({"GET", "HEAD", "OPTIONS"})
PROXIES_PATH: Final = proxies.router.prefix + "/"
AI_PATH: Final = ai.router.prefix

type Lifespan = Callable[[FastAPI], AbstractAsyncContextManager[None]]


def create_app(
    services: Services,
    allowed_hosts: Iterable[str],
    *,
    lifespan: Lifespan | None = None,
    client_dir: Path = CLIENT_DIR,
) -> FastAPI:
    """Return the app serving `services`, answering only requests addressed to `allowed_hosts`.

    The web client built into `client_dir` is served at every path outside `/api`.

    Checking the Host header blocks DNS rebinding; checking the device admits
    only those the household let in; checking a state-changing request's Origin
    against its Host blocks other sites' pages from using a signed-in browser.
    """
    hosts = tuple(allowed_hosts)
    app = FastAPI(title="medleyplay", version=__version__, lifespan=lifespan)
    app.state.services = services
    app.state.allowed_hosts = hosts
    app.include_router(accounts.router)
    app.include_router(addresses.router)
    app.include_router(catalog.router)
    app.include_router(downloads.router)
    app.include_router(plugins.router)
    app.include_router(jobs.router)
    app.include_router(libraries.router)
    app.include_router(playback.router)
    app.include_router(linked_accounts.router)
    app.include_router(proxies.router)
    app.include_router(ai.router)
    app.include_router(links.router)
    app.include_router(events.router)
    app.include_router(settings.router)
    app.include_router(preferences.router)
    app.include_router(ratings.router)
    app.include_router(mode.router)
    app.include_router(details.router)
    app.include_router(songs.router)
    app.include_router(covers.router)
    app.include_router(enrichers.router)
    app.include_router(storage.router)
    app.include_router(devices.router)
    app.include_router(remote.router)
    app.mount("/", client_app(client_dir))
    app.add_exception_handler(RequestValidationError, _handle_invalid_request)  # type: ignore[arg-type] # Starlette types handlers for any Exception
    app.add_exception_handler(MedleyplayError, _handle_domain_error)  # type: ignore[arg-type] # Starlette types handlers for any Exception
    # The last added runs first: the Host check, then the device check, then the Origin check.
    app.middleware("http")(_refuse_cross_origin_writes)
    app.middleware("http")(devices.admit_devices)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=list(hosts))
    return app


def _handle_domain_error(_: Request, error: MedleyplayError) -> JSONResponse:
    code = next(code for kind, code in _STATUS_OF if isinstance(error, kind))
    detail = _DETAIL_OF.get(type(error), str(error))
    headers = (
        {"Retry-After": str(error.retry_after_seconds)}
        if isinstance(error, SignInThrottledError)
        else None
    )
    body = {"detail": detail} if error.code is None else {"detail": detail, "code": error.code}
    return JSONResponse(body, status_code=code, headers=headers)


async def _handle_invalid_request(request: Request, error: RequestValidationError) -> Response:
    """Answer 422 as FastAPI does, except for a proxy or an AI provider: their bodies hold secrets.

    FastAPI echoes the input of each error, which for a body that is missing a key
    is the whole body.
    """
    if request.url.path.startswith(PROXIES_PATH):
        detail = 'The body must be JSON like {"url": "socks5h://127.0.0.1:7890"}.'
        return JSONResponse({"detail": detail}, status_code=status.HTTP_422_UNPROCESSABLE_CONTENT)
    if request.url.path.startswith(AI_PATH):
        return JSONResponse(
            {"detail": _ai_body_like(request.url.path)},
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        )
    return await request_validation_exception_handler(request, error)


def _ai_body_like(path: str) -> str:
    if path.endswith("/key"):
        return 'The body must be JSON like {"key": "…"}.'
    if path.endswith("/model"):
        return 'The body must be JSON like {"model": "deepseek-flash"}.'
    if path.endswith("/order"):
        return 'The body must be JSON like {"ids": ["…", "…"]}, naming every provider once.'
    return (
        'The body must be JSON like {"base_url": "https://api.deepseek.com", '
        '"model": "deepseek-flash", "key": "…"}, with a key only for a provider that needs one.'
    )


async def _refuse_cross_origin_writes(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    origin = request.headers.get("origin")
    if request.method in _SAFE_METHODS or origin is None:
        return await call_next(request)
    if urlsplit(origin).netloc != request.headers.get("host"):
        return JSONResponse(
            {"detail": "Cross-site requests are refused."},
            status_code=status.HTTP_403_FORBIDDEN,
        )
    return await call_next(request)
