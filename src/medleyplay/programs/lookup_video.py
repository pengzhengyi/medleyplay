"""Resolve and read one video without downloading any of its parts."""

from dataclasses import dataclass
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel

from medleyplay.plugin_api import (
    CANONICALIZE,
    READ_VIDEO,
    Canonicalize,
    PartNumber,
    ProviderStopError,
    ReadVideo,
    VideoDetails,
    VideoId,
    VideoStatus,
)
from medleyplay.plugin_host.job import (
    AnswerFailedError,
    JobContext,
    JobProgram,
    PluginCallFailedError,
    ProviderAttemptStoppedError,
)
from medleyplay.video_urls import public_video_link


class Reason(StrEnum):
    """Why a video could not be read."""

    GONE = "gone"
    NEEDS_LOGIN = "needs_login"
    NETWORK = "network"
    REFUSED = "refused"
    FAULT = "fault"


@dataclass(frozen=True)
class Unreadable:
    """A reason to offer manual part entry instead of a list from the site."""

    reason: Reason
    message: str


class VideoRequest(BaseModel):
    """The public video link; the runner supplies any proxy separately."""

    link: str
    site: Literal["bilibili"] = "bilibili"


class Resolved(BaseModel):
    """The checked video identity and just the metadata needed to choose its parts."""

    kind: str
    video: VideoId
    part: PartNumber | None
    read: VideoDetails | Unreadable


def read_failure(kind: str, message: str) -> Unreadable:
    """Translate a plugin failure into the reason shown beside manual entry."""
    return Unreadable(
        {"network": Reason.NETWORK, "auth": Reason.REFUSED, "plugin": Reason.FAULT}[kind], message
    )


def read_details(details: VideoDetails) -> VideoDetails | Unreadable:
    """Keep the parts, or why the site did not return them."""
    if details.status is VideoStatus.OK:
        return details
    reason = Reason.GONE if details.status is VideoStatus.GONE else Reason.NEEDS_LOGIN
    return Unreadable(reason, details.message or f"The video is {details.status}.")


def run(request: VideoRequest, context: JobContext) -> Resolved:
    """Canonicalize before reading; only a failure after identification permits manual entry."""
    site = request.site
    canonical = context.call(
        CANONICALIZE, site, Canonicalize(link=public_video_link(request.link), proxy=context.proxy)
    )
    try:
        public_video_link(canonical.link)
    except ValueError:
        msg = "The link doesn't name a Bilibili video."
        raise AnswerFailedError(msg, kind="invalid") from None
    if canonical.video is None:
        msg = "The link doesn't name a video."
        raise AnswerFailedError(msg, kind="invalid")
    if canonical.video in context.held_videos:
        message = "Download held. Medleyplay will not ask the provider again."
        stopped = ProviderAttemptStoppedError(ProviderStopError(message))
        stopped.video = canonical.video
        raise stopped
    try:
        details = context.call(
            READ_VIDEO, site, ReadVideo(video=canonical.video, proxy=context.proxy)
        )
    except PluginCallFailedError as error:
        read: VideoDetails | Unreadable = read_failure(error.kind, context.safe_text(str(error)))
    except ProviderAttemptStoppedError as error:
        error.video = canonical.video
        raise
    else:
        details = details.model_copy(
            update={
                "message": context.safe_text(details.message),
                "title": context.safe_text(details.title),
                "uploader": context.safe_text(details.uploader),
                "parts": tuple(
                    p.model_copy(update={"title": context.safe_text(p.title)})
                    for p in details.parts
                ),
                "qualities": tuple(
                    q.model_copy(update={"label": context.safe_text(q.label)})
                    for q in details.qualities
                ),
            }
        )
        read = read_details(details)
    return Resolved(kind=site, video=canonical.video, part=canonical.part, read=read)


LOOKUP_VIDEO = JobProgram(VideoRequest, Resolved, run)
