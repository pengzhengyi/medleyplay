"""The links API: looking a pasted link up, and adding the parts the household chose."""

from typing import Annotated, Literal

from fastapi import APIRouter, Response
from pydantic import BaseModel, ConfigDict, Field

from medleyplay.application.links import Added, AlbumChoice, Lookup, PartChoice
from medleyplay.application.video_lookups import SavedLookup
from medleyplay.domain.accounts import Account
from medleyplay.domain.jobs import JobId, JobState, JobView
from medleyplay.domain.links import MAX_PART_NUMBER
from medleyplay.plugin_api import BEST_QUALITY, PartNumber
from medleyplay.programs.lookup_video import Reason
from medleyplay.web.deps import LinksDep, SignedInAccount, VideoLookupsDep
from medleyplay.web.ids import RowId
from medleyplay.web.jobs import JobOut

router = APIRouter(prefix="/api/links", tags=["links"])

type Link = Annotated[
    str, Field(max_length=2048, examples=["https://b23.tv/abc123", "BV1Xx41117Tz"])
]
type SelectedParts = Annotated[list[PartNumber], Field(min_length=1, max_length=MAX_PART_NUMBER)]


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

    part: PartNumber
    title: str = Field(max_length=512, examples=["Night Drive"])
    artist: str = Field(default="", max_length=512, examples=["Blue Room"])


class ChoicesIn(BaseModel):
    """Chosen parts of one server-held result."""

    model_config = ConfigDict(extra="forbid")
    quality: str = Field(default=BEST_QUALITY, max_length=32)
    parts: list[PartIn] = Field(max_length=MAX_PART_NUMBER)

    def choices(self) -> list[PartChoice]:
        """Return the choices for the application."""
        return [PartChoice(p.part, p.title, p.artist) for p in self.parts]


class AddIn(ChoicesIn):
    """The parts of a link's video to add, at a quality: one the lookup listed, or `best`.

    A video that couldn't be read is added on these titles and artists alone, at `best`.
    """

    model_config = ConfigDict(extra="ignore")
    link: Link


class DownloadIn(BaseModel):
    """Download the selected new parts without editing them."""

    model_config = ConfigDict(extra="forbid")
    mode: Literal["download"]
    quality: str = Field(default=BEST_QUALITY, max_length=32)
    parts: SelectedParts | None = None


class _AlbumIn(BaseModel):
    """The credits and source quality shared by both album layouts."""

    model_config = ConfigDict(extra="forbid")
    album: str = Field(min_length=1, max_length=512)
    artist: str = Field(default="", max_length=512)
    quality: str = Field(default=BEST_QUALITY, max_length=32)


class AlbumIn(_AlbumIn):
    """Import the selected parts as numbered songs."""

    mode: Literal["album"]
    parts: SelectedParts | None = None


class JoinedIn(_AlbumIn):
    """Import only the explicitly selected parts as one album file."""

    mode: Literal["joined"]
    parts: SelectedParts


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
    return [_added(each, me) for each in links.add(me, body.link, body.quality, body.choices())]


class SavedLookupOut(BaseModel):
    """An open lookup in Downloads, including its parts when opened."""

    id: int
    label: str
    state: JobState
    message: str
    result: LookupOut | None

    @classmethod
    def of(cls, saved: SavedLookup) -> "SavedLookupOut":
        """Show an Account its saved choice."""
        return cls(
            id=saved.id,
            label=saved.label,
            state=saved.state,
            message=saved.message,
            result=LookupOut.of(saved.result) if saved.result else None,
        )


@router.post("/lookups", status_code=202)
def start_lookup(body: LinkIn, me: SignedInAccount, lookups: VideoLookupsDep) -> SavedLookupOut:
    """Queue an interactive lookup; no Track is added until confirmation."""
    return SavedLookupOut.of(lookups.start(me, body.link))


@router.get("/lookups")
def list_lookups(
    me: SignedInAccount, lookups: VideoLookupsDep, response: Response
) -> list[SavedLookupOut]:
    """List this Account's open lookups."""
    response.headers["Cache-Control"] = "private, no-store"
    return [SavedLookupOut.of(saved) for saved in lookups.list_for(me)]


@router.get("/lookups/{job_id}")
def open_lookup(
    job_id: RowId, me: SignedInAccount, lookups: VideoLookupsDep, response: Response
) -> SavedLookupOut:
    """Read the selected video's saved parts without contacting the site."""
    response.headers["Cache-Control"] = "private, no-store"
    return SavedLookupOut.of(lookups.get(me, JobId(job_id)))


@router.post("/lookups/{job_id}")
def confirm_lookup(
    job_id: RowId,
    body: ChoicesIn | DownloadIn | AlbumIn | JoinedIn,
    me: SignedInAccount,
    lookups: VideoLookupsDep,
) -> list[AddedOut]:
    """Confirm the parts chosen from this Account's lookup."""
    if isinstance(body, ChoicesIn):
        added = lookups.confirm(me, JobId(job_id), body.quality, body.choices())
    else:
        album = (
            AlbumChoice(body.album, body.artist, joined=isinstance(body, JoinedIn))
            if isinstance(body, _AlbumIn)
            else None
        )
        added = lookups.import_parts(me, JobId(job_id), body.quality, album, body.parts)
    return [_added(each, me) for each in added]


@router.delete("/lookups/{job_id}", status_code=204)
def dismiss_lookup(job_id: RowId, me: SignedInAccount, lookups: VideoLookupsDep) -> None:
    """Dismiss this Account's lookup without adding any parts."""
    lookups.dismiss(me, JobId(job_id))


def _added(added: Added, me: Account) -> AddedOut:
    job = None if added.job is None else JobOut.of(JobView(added.job), me)
    return AddedOut(part=added.part, track_id=added.track_id, source_id=added.source_id, job=job)
