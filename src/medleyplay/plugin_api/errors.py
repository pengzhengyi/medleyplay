"""The failures a plugin reports; any other exception is a fault in the plugin."""

from typing import Literal

type ProviderStopReason = Literal["provider_refused", "response_unknown"]


class NetworkError(Exception):
    """The site couldn't be reached, or stopped answering; retrying later may work."""

    def __init__(self, message: str = "", *, http_status: int | None = None) -> None:
        """Record a known HTTP status separately from provider text."""
        super().__init__(message)
        self.http_status = http_status


class AuthError(Exception):
    """The site refused the login, for example because it expired."""


class ProviderStopError(RuntimeError):
    """The provider returned an outcome that must not be replayed automatically."""

    def __init__(
        self,
        message: str,
        *,
        reason: ProviderStopReason = "provider_refused",
        status: int | None = None,
        media: bool = False,
    ) -> None:
        """Record typed evidence without the request URL or headers."""
        super().__init__(message)
        self.reason = reason
        self.status = status
        self.media = media


class DownloadRefusedError(ProviderStopError):
    """The provider rejected the download attempt without rejecting the login."""
