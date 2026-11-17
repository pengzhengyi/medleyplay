"""Links to pictures an AI model suggests for an album's cover or an artist, and fetching one.

Asked for it, an AI model names a few links to pictures of the album or the artist,
in the AI's lane; what it names is kept, and asking again replaces it. The household's
browser shows each from its own site. Nothing is fetched until someone approves a
link, and then only a link the model named: the AI plugin fetches it from its public
site, in a lane of its own, and the image is kept as a cover. Using it as the album's
cover or the artist's photo is the household's next step, as with any cover.

An album is known by its name and artist as written, folded, as its covers are; an
artist by its id, and only an artist a site named may have a photo.
"""

import hashlib
from dataclasses import dataclass
from datetime import datetime
from functools import partial
from pathlib import Path
from typing import Final

from sqlalchemy.orm import Session, sessionmaker

from medleyplay.application import Clock
from medleyplay.application.ai import is_set_up, provider_named
from medleyplay.application.album_covers import album_key, checked_album, songs_of
from medleyplay.application.jobs import JobKind, JobService, Lane
from medleyplay.application.plugins import PluginService
from medleyplay.application.scan_covers import NotACoverError, keep_copy
from medleyplay.domain.accounts import Account
from medleyplay.domain.covers import cover_type, is_cover_id
from medleyplay.domain.enrichers import AI_DETAILS
from medleyplay.domain.errors import ConflictError, NotFoundError
from medleyplay.domain.jobs import Job, JobState, failure_shown_to
from medleyplay.persistence.schema import ArtistRow, ImageLinksRow
from medleyplay.plugin_api import IMAGE_FETCHER, IMAGE_SUGGESTER, ImageSubject
from medleyplay.programs.image_links import (
    FetchedImageResult,
    FetchImageJob,
    SuggestedImagesResult,
    SuggestImagesJob,
)

SUGGEST_IMAGES_KIND: Final = "suggest_images"
FETCH_IMAGE_KIND: Final = "fetch_image"
PLUGIN: Final = AI_DETAILS.name
"""The plugin asked, to suggest links and to fetch one."""
FETCHING: Final = "web-images"
"""The lane fetching keeps to, apart from the AI's: it borrows no AI, and waits for none."""
SUGGEST_TARGET: Final = "image-links:"
FETCH_TARGET: Final = "image-fetch:"

type SuggestImagesKind = JobKind[SuggestImagesJob, SuggestedImagesResult]
type FetchImageKind = JobKind[FetchImageJob, FetchedImageResult]


@dataclass(frozen=True)
class AlbumPictured:
    """The cover of the album `album` by `artist`, empty for none."""

    album: str
    artist: str


@dataclass(frozen=True)
class ArtistPictured:
    """A photo of the artist `artist_id`."""

    artist_id: str


type Pictured = AlbumPictured | ArtistPictured


@dataclass(frozen=True)
class SuggestedLink:
    """A link suggested, the page showing it, why, and what fetching it gave.

    `cover` is the cover holding the image once fetched; `unavailable` says why there
    is no image there. `fetching` says it is being fetched now, and `failure` why the
    last fetching failed, to the Account that asked and to admins.
    """

    url: str
    page: str | None
    why: str
    cover: str | None
    unavailable: str
    fetching: bool
    failure: str | None


@dataclass(frozen=True)
class PictureLinks:
    """The links a model last suggested, by whom and when, and what is being asked.

    `asking` says a model is asked now, and `waiting` that asking or fetching waits
    for medleyplay to be Online, or to try again. `may_suggest` says a model may be
    asked: one is set up, and the AI plugin is on.
    """

    links: tuple[SuggestedLink, ...]
    model: str
    host: str
    asked_at: datetime | None
    asking: bool
    waiting: bool
    failure: str | None
    may_suggest: bool


@dataclass(frozen=True)
class _Subject:
    subject: ImageSubject
    key: str
    name: str
    artist: str


def suggest_images_kind(clock: Clock) -> SuggestImagesKind:
    """Return the kind of Job that asks an AI model for links to a picture."""
    return JobKind(
        name=SUGGEST_IMAGES_KIND,
        program="medleyplay.programs.image_links:SUGGEST_IMAGES_PROGRAM",
        request=SuggestImagesJob,
        result=SuggestedImagesResult,
        complete=partial(_complete_suggest, clock=clock),
        points=(IMAGE_SUGGESTER.name,),
        needs_network=True,
        lane_field="suggester",
        lanes={PLUGIN: Lane(spacing=AI_DETAILS.spacing, lends_ai=True, shared=AI_DETAILS.name)},
    )


def fetch_image_kind(covers_folder: Path) -> FetchImageKind:
    """Return the kind of Job that fetches an image approved, keeping it in `covers_folder`."""
    return JobKind(
        name=FETCH_IMAGE_KIND,
        program="medleyplay.programs.image_links:FETCH_IMAGE_PROGRAM",
        request=FetchImageJob,
        result=FetchedImageResult,
        complete=partial(_complete_fetch, covers_folder=covers_folder),
        points=(IMAGE_FETCHER.name,),
        needs_network=True,
        lane_field="fetcher",
        lanes={PLUGIN: Lane(spacing=AI_DETAILS.spacing, shared=FETCHING)},
    )


@dataclass(frozen=True)
class ImageLinkKinds:
    """The kinds of Job the service submits: asking for links, and fetching one."""

    suggest: SuggestImagesKind
    fetch: FetchImageKind


def image_link_kinds(clock: Clock, covers_folder: Path) -> ImageLinkKinds:
    """Return the kinds of Job the service submits, keeping images in `covers_folder`."""
    return ImageLinkKinds(suggest_images_kind(clock), fetch_image_kind(covers_folder))


class ImageLinkService:
    """Asks an AI model for links to pictures, and fetches the one approved."""

    def __init__(
        self,
        units: sessionmaker[Session],
        plugins: PluginService,
        jobs: JobService,
        kinds: ImageLinkKinds,
        covers_folder: Path,
    ) -> None:
        """Create the service, submitting Jobs of `kinds` and finding images in `covers_folder`."""
        self._units = units
        self._plugins = plugins
        self._jobs = jobs
        self._kinds = kinds
        self._covers_folder = covers_folder

    def suggest(self, caller: Account, pictured: Pictured) -> None:
        """Ask an AI model for links to the picture; asking again while asked waits."""
        if not self._may_suggest():
            message = "Turn on the ai-details plugin to ask an AI model."
            raise ConflictError(message)
        with self._units() as db:
            if not is_set_up(db):
                message = "Set up an AI provider in Settings to ask it."
                raise ConflictError(message)
            subject = _subject_of(db, pictured)
            songs = (
                songs_of(db, subject.name, subject.artist)
                if subject.subject is ImageSubject.ALBUM
                else ()
            )
        request = SuggestImagesJob(
            subject=subject.subject,
            name=subject.name,
            artist=subject.artist,
            songs=songs,
            suggester=PLUGIN,
        )
        self._jobs.submit(self._kinds.suggest, _suggest_target(subject), request, caller.id)

    def links(self, viewer: Account, pictured: Pictured) -> PictureLinks:
        """Return the links last suggested for the picture, and what is being asked."""
        with self._units() as db:
            subject = _subject_of(db, pictured)
            row = db.get(ImageLinksRow, (subject.subject.value, subject.key))
            ai = is_set_up(db)
        asking = self._jobs.latest(SUGGEST_IMAGES_KIND, _suggest_target(subject))
        fetches = {
            str(link["url"]): self._jobs.latest(
                FETCH_IMAGE_KIND, _fetch_target(subject, str(link["url"]))
            )
            for link in ([] if row is None else row.links)
        }
        active = [
            job for job in (asking, *fetches.values()) if job is not None and job.state.is_active
        ]
        return PictureLinks(
            links=tuple(
                self._link_of(link, fetches[str(link["url"])], viewer)
                for link in ([] if row is None else row.links)
            ),
            model="" if row is None else row.model,
            host="" if row is None else row.host,
            asked_at=None if row is None else row.asked_at,
            asking=asking is not None and asking.state.is_active,
            # Asking needs the network, so it waits while medleyplay is Offline.
            waiting=any(job.state is JobState.WAITING or not self._jobs.online() for job in active),
            failure=_failure(asking, viewer),
            may_suggest=ai and self._may_suggest(),
        )

    def approve(self, caller: Account, pictured: Pictured, url: str) -> str | None:
        """Fetch the image at `url`, a link the model suggested; return its cover if fetched.

        A link fetched before whose cover is still kept is not fetched again; one no
        image was found at is asked again. Approving while it is fetched waits.
        """
        with self._units() as db:
            subject = _subject_of(db, pictured)
            row = db.get(ImageLinksRow, (subject.subject.value, subject.key))
            link = None if row is None else next((x for x in row.links if x["url"] == url), None)
        if link is None:
            message = "The AI model suggested no such link."
            raise NotFoundError(message)
        cover = self._kept(link)
        if cover is not None:
            return cover
        request = FetchImageJob(url=url, fetcher=PLUGIN)
        self._jobs.submit(self._kinds.fetch, _fetch_target(subject, url), request, caller.id)
        return None

    def _may_suggest(self) -> bool:
        keys = self._plugins.available_keys()
        return PLUGIN in keys.get(IMAGE_SUGGESTER.name, []) and PLUGIN in keys.get(
            IMAGE_FETCHER.name, []
        )

    def _kept(self, link: dict[str, object]) -> str | None:
        """Return the link's cover, if it was fetched and its file is still kept."""
        cover = link.get("cover")
        if not isinstance(cover, str) or not is_cover_id(cover):
            return None
        try:
            with (self._covers_folder / cover).open("rb") as file:
                return cover if cover_type(file.read(12)) is not None else None
        except OSError:
            return None

    def _link_of(
        self, link: dict[str, object], fetch: Job | None, viewer: Account
    ) -> SuggestedLink:
        page = link.get("page")
        return SuggestedLink(
            url=str(link["url"]),
            page=page if isinstance(page, str) else None,
            why=str(link.get("why", "")),
            cover=self._kept(link),
            unavailable=str(link.get("unavailable", "")),
            fetching=fetch is not None and fetch.state.is_active,
            failure=_failure(fetch, viewer),
        )


def _subject_of(db: Session, pictured: Pictured) -> _Subject:
    if isinstance(pictured, AlbumPictured):
        album, artist = checked_album(pictured.album, pictured.artist)
        return _Subject(ImageSubject.ALBUM, album_key(album, artist), album, artist)
    artist_row = db.get(ArtistRow, pictured.artist_id)
    if artist_row is None:
        message = "No site named such an artist."
        raise NotFoundError(message)
    return _Subject(ImageSubject.ARTIST, artist_row.id, artist_row.name, "")


def _suggest_target(subject: _Subject) -> str:
    return f"{SUGGEST_TARGET}{subject.subject.value}:{subject.key}"


def _fetch_target(subject: _Subject, url: str) -> str:
    digest = hashlib.sha256(url.encode()).hexdigest()[:16]
    return f"{FETCH_TARGET}{subject.subject.value}:{subject.key}:{digest}"


def _subject_and_key(target: str, prefix: str) -> tuple[str, str]:
    subject, _, rest = target.removeprefix(prefix).partition(":")
    return subject, rest.partition(":")[0]


def _failure(job: Job | None, viewer: Account) -> str | None:
    if job is None or job.state is not JobState.FAILED:
        return None
    return failure_shown_to(job, viewer) or None


def _complete_suggest(
    db: Session, job: Job, result: SuggestedImagesResult, *, clock: Clock
) -> None:
    """Keep the links suggested, replacing those suggested before, with the model that answered."""
    subject, key = _subject_and_key(job.target, SUGGEST_TARGET)
    named = provider_named(db, result.ai_answered or None)
    model, host = named if named is not None else ("an AI model", "")
    row = db.get(ImageLinksRow, (subject, key)) or ImageLinksRow(subject=subject, key=key)
    row.name, row.artist = result.name, result.artist
    row.links = [link.model_dump(mode="json") for link in result.links]
    row.model, row.host, row.asked_at = model, host, clock()
    db.add(row)


def _complete_fetch(
    db: Session, job: Job, result: FetchedImageResult, *, covers_folder: Path
) -> None:
    """Keep the image fetched as a cover, or why there is none, on the link it was fetched for.

    An image of a link no longer suggested, as when a model was asked again since, is
    dropped unkept.
    """
    row = db.get(ImageLinksRow, _subject_and_key(job.target, FETCH_TARGET))
    if row is None or not any(link["url"] == result.url for link in row.links):
        return
    cover: str | None = None
    unavailable = result.unavailable
    if result.cover is not None:
        try:
            cover = keep_copy(result.cover, covers_folder)
        except NotACoverError:
            unavailable = "The link is not an image: not a JPEG, PNG, or WebP image."
    row.links = [
        {**link, "cover": cover, "unavailable": "" if cover else unavailable}
        if link["url"] == result.url
        else link
        for link in row.links
    ]
