"""The closed vocabulary used by download workers, receipts, and public status."""

from enum import StrEnum
from typing import Final

HTTP_STATUS_MIN: Final = 100
HTTP_STATUS_MAX: Final = 599
DOWNLOAD_PROGRAM: Final = "medleyplay.programs.download_source:DOWNLOAD_SOURCE"


class DownloadStage(StrEnum):
    """A download's work, not the provider's log messages."""

    RESOLVE = "resolve"
    TRANSFER = "transfer"
    JOIN = "join"
    VALIDATE = "validate"


class DownloadEvent(StrEnum):
    """An admission, dispatch, stage, or settlement in the local timeline."""

    QUEUED = "queued"
    DISPATCHED = "dispatched"
    STAGE = "stage"
    WAITING = "waiting"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


class DownloadReason(StrEnum):
    """A public reason code independent of tool or provider prose."""

    AUTH = "auth"
    NETWORK = "network"
    KEYCHAIN = "keychain"
    PLUGIN = "plugin"
    PROGRAM = "program"
    INVALID = "invalid"
    INVALID_ARTIFACT = "invalid_artifact"
    GONE = "gone"
    REFUSED = "refused"
    HELD = "held"
    PROVIDER_REFUSED = "provider_refused"
    RESPONSE_UNKNOWN = "response_unknown"
    ATTEMPT_UNCERTAIN = "attempt_uncertain"
    RETRY_EXHAUSTED = "retry_exhausted"
    ROUTE_CHANGED = "route_changed"
    BACKEND_CHANGED = "backend_changed"
    REPLACED = "replaced"


class DownloadRoute(StrEnum):
    """Configured routing; it does not certify egress."""

    DIRECT = "direct"
    SITE_PROXY = "site_proxy"


_REASONS: Final = {
    DownloadReason.AUTH: "Bilibili refused the login.",
    DownloadReason.NETWORK: "The provider could not be reached.",
    DownloadReason.KEYCHAIN: "The Keychain could not be read.",
    DownloadReason.PLUGIN: "The download adapter failed.",
    DownloadReason.PROGRAM: "The download could not be completed.",
    DownloadReason.INVALID: "The provider did not return usable audio.",
    DownloadReason.INVALID_ARTIFACT: "The download did not produce a valid audio file.",
    DownloadReason.GONE: "The site no longer has this video.",
    DownloadReason.REFUSED: "The download could not start or finish locally.",
    DownloadReason.HELD: "Download held. Medleyplay will not ask the provider again.",
    DownloadReason.PROVIDER_REFUSED: "The provider refused the request. No retry scheduled.",
    DownloadReason.RESPONSE_UNKNOWN: (
        "The provider returned an unclassified response. No retry scheduled."
    ),
    DownloadReason.ATTEMPT_UNCERTAIN: (
        "The provider attempt ended without a confirmed outcome. No retry scheduled."
    ),
    DownloadReason.RETRY_EXHAUSTED: "Download retry limit reached.",
    DownloadReason.ROUTE_CHANGED: "The configured provider route changed. No retry scheduled.",
    DownloadReason.BACKEND_CHANGED: "The configured download backend changed. No retry scheduled.",
    DownloadReason.REPLACED: "A local file replaced this download.",
}


def reason_for(kind: str | None) -> DownloadReason | None:
    """Project even legacy or unknown failure codes without trusting their text."""
    if kind is None:
        return None
    try:
        return DownloadReason(kind)
    except ValueError:
        return DownloadReason.PROGRAM


def reason_message(reason: DownloadReason | None, status: int | None = None) -> str:
    """Render a reason from a fixed vocabulary and a bounded HTTP status."""
    if reason is None:
        return ""
    if status is not None and HTTP_STATUS_MIN <= status <= HTTP_STATUS_MAX:
        if reason is DownloadReason.RESPONSE_UNKNOWN:
            return f"The provider returned unexplained HTTP {status}. No retry scheduled."
        if reason is DownloadReason.PROVIDER_REFUSED:
            return f"The provider refused the request (HTTP {status}). No retry scheduled."
        if reason is DownloadReason.NETWORK:
            return f"The provider returned a temporary HTTP error ({status})."
    return _REASONS[reason]
