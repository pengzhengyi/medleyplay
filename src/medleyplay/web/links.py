"""The links API: looking a pasted link up, and adding the parts the household chose."""

from typing import Annotated

from fastapi import APIRouter
from pydantic import BaseModel, Field

from medleyplay.application.links import Added, Lookup, PartChoice, Reason
from medleyplay.domain.accounts import Account
from medleyplay.domain.jobs import JobView
from medleyplay.plugin_api import BEST_QUALITY
from medleyplay.web.deps import LinksDep, SignedInAccount
from medleyplay.web.jobs import JobOut

router = APIRouter(prefix="/api/links", tags=["links"])

type Link = Annotated[
    str, Field(max_length=2048, examples=["https://b23.tv/abc123", "BV1Xx41117Tz"])
]


class LinkIn(BaseModel):
    """A link to look up, as pasted, or a bare video code such as `BV1Xx41117Tz`."""

    link: Link


class PartOut(BaseModel):
    """One part of the video, and its Track when it is already in the catalog."""

    part: int
    title: str
    duration_ms: int | None
    track_id: int | None


class QualityOut(BaseModel):
    """A quality the video can be added at."""

    id: str
    label: str
    kbps: int | None


class LookupOut(BaseModel):
    """The video a link names.

    A video that couldn't be read has `readable` false, the `reason` and a `message`
    saying why, no title, uploader, or qualities, and one part: the one the link
    names, or part 1.
    """

    kind: str
    video: str
    title: str
    uploader: str
    parts: list[PartOut]
    qualities: list[QualityOut]
    readable: bool
    reason: Reason | None
    message: str

    @classmethod
    def of(cls, lookup: Lookup) -> "LookupOut":
        """Return the API view of `lookup`."""
        unreadable = lookup.unreadable
        return cls(
            kind=lookup.kind,
            video=lookup.video,
            title=lookup.title,
            uploader=lookup.uploader,
            parts=[PartOut(**vars(part)) for part in lookup.parts],
            qualities=[QualityOut(**quality.model_dump()) for quality in lookup.qualities],
            readable=unreadable is None,
            reason=None if unreadable is None else unreadable.reason,
            message="" if unreadable is None else unreadable.message,
        )


class PartIn(BaseModel):
    """A part to add, under the title and artist the household chose."""

    part: int = Field(ge=1)
    title: str = Field(max_length=512, examples=["Night Drive"])
    artist: str = Field(default="", max_length=512, examples=["Blue Room"])


class AddIn(BaseModel):
    """The parts of a link's video to add, at a quality: one the lookup listed, or `best`.

    A video that couldn't be read is added on these titles and artists alone, at `best`.
    """

    link: Link
    quality: str = Field(default=BEST_QUALITY, max_length=32)
    parts: list[PartIn] = Field(max_length=50)


class AddedOut(BaseModel):
    """A part's Track and Source, and the Job downloading it, if one is needed."""

    part: int
    track_id: int
    source_id: int
    job: JobOut | None


@router.post("/lookup")
def look_up(body: LinkIn, me: SignedInAccount, links: LinksDep) -> LookupOut:
    """Return the video a link names; a link that isn't one answers 422.

    A video that can't be read answers `readable: false` and why.
    """
    return LookupOut.of(links.lookup(me, body.link))


@router.post("")
def add(body: AddIn, me: SignedInAccount, links: LinksDep) -> list[AddedOut]:
    """Add the chosen parts as Tracks and start downloading them; adding again adds nothing new."""
    choices = [PartChoice(part.part, part.title, part.artist) for part in body.parts]
    return [_added(each, me) for each in links.add(me, body.link, body.quality, choices)]


def _added(added: Added, me: Account) -> AddedOut:
    job = None if added.job is None else JobOut.of(JobView(added.job), me)
    return AddedOut(part=added.part, track_id=added.track_id, source_id=added.source_id, job=job)
