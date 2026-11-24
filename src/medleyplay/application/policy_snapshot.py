"""Reading everything the download policy plans from, in one transaction.

The snapshot fails closed: a *Keep downloaded* Playlist whose rules can't be
read raises `UnreadableRulesError`, so an evaluation that can't tell what is
wanted removes nothing.
"""

import shutil
from collections import defaultdict
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from medleyplay.application.album_ratings import album_ratings_by_account, library_album_of
from medleyplay.application.download_budgets import active_budgets, cache_copies, estimate_of
from medleyplay.application.rule_schema import read_rules
from medleyplay.application.segments import album_file_of
from medleyplay.application.track_facts import track_facts
from medleyplay.domain.accounts import AccountId
from medleyplay.domain.album_ratings import AlbumRatings, effective_rating
from medleyplay.domain.catalog import SourceId, SourceState, TrackId
from medleyplay.domain.downloads import (
    DOWNLOAD_KIND,
    JOIN_SCRATCH_BYTES,
    MANUAL_BACKEND,
    download_target,
)
from medleyplay.domain.errors import InvalidInputError
from medleyplay.domain.jobs import JobState
from medleyplay.domain.libraries import LIBRARY_SOURCE
from medleyplay.domain.linked_accounts import LinkState
from medleyplay.domain.links import BILIBILI_SOURCE, video_selection
from medleyplay.domain.policy import (
    Failure,
    PolicyState,
    Standing,
    StoredDownload,
    Wanted,
)
from medleyplay.domain.rules import TrackFacts, matches
from medleyplay.persistence.schema import (
    DownloadRow,
    JobRow,
    LinkedAccountRow,
    PlaylistEntryRow,
    PlaylistRow,
    SourceRow,
    TrackRow,
    TrackStateRow,
)
from medleyplay.programs.joined_audio import join_tools


class UnreadableRulesError(InvalidInputError):
    """A *Keep downloaded* Playlist's stored rules can't be read, so nothing may be removed."""


@dataclass(frozen=True)
class Snapshot:
    """The policy's state, and what it needs to report and to remove files."""

    state: PolicyState
    wanted_bytes: Mapping[AccountId, int]
    """The space each Account's wants hold: their Downloads, and estimates for the rest."""
    file_names: Mapping[SourceId, str]


@dataclass(frozen=True)
class _Source:
    id: SourceId
    track_id: TrackId
    kind: str
    state: str
    details: dict[str, object] | None
    joined: bool = False
    scratch: int = 0

    @classmethod
    def of(cls, row: SourceRow) -> "_Source":
        if row.kind == BILIBILI_SOURCE:
            selection = video_selection(row.locator)
            joined = selection.joined
            scratch = JOIN_SCRATCH_BYTES if joined and len(selection.parts) > 1 else 0
        else:
            joined, scratch = False, 0
        return cls(
            SourceId(row.id),
            TrackId(row.track_id),
            row.kind,
            row.state,
            row.details,
            joined,
            scratch,
        )


def read_snapshot(
    db: Session,
    now: datetime,
    limit: int | None,
    downloadable_sites: Iterable[str],
    data_dir: Path,
) -> Snapshot:
    """Return the policy's state as the database and the data folder hold it now."""
    sites = frozenset(downloadable_sites)
    wanted_by = _wanted_by(db, now)
    sources = [_Source.of(row) for row in db.scalars(select(SourceRow).order_by(SourceRow.id))]
    by_track: defaultdict[TrackId, list[_Source]] = defaultdict(list)
    for source in sources:
        by_track[source.track_id].append(source)
    standings, durations = _standings(db)
    downloads = {SourceId(row.source_id): row for row in db.scalars(select(DownloadRow))}
    active = active_budgets(db)
    source_of = {source.id: source for source in sources}
    tools = join_tools() is not None

    def estimate(source: _Source) -> int:
        return estimate_of(source.details, durations.get(source.track_id))

    stored = tuple(
        StoredDownload(
            source_id=source_id,
            size=row.size,
            standing=standings[source_of[source_id].track_id],
            downloaded_at=row.downloaded_at,
            last_served_at=row.last_served_at,
            last_wanted_at=row.last_wanted_at,
            wanted=source_of[source_id].track_id in wanted_by,
            replaceable=source_of[source_id].state == SourceState.OK
            and source_of[source_id].kind in sites
            and (tools or not source_of[source_id].scratch)
            and row.backend != MANUAL_BACKEND,
            active_job=source_id in active,
        )
        for source_id, row in downloads.items()
        if source_id in source_of
    )
    logins = _valid_logins(db, now)
    history = _download_history(db)
    saved = _logins_saved(db)
    wanted: list[Wanted] = []
    held: defaultdict[AccountId, int] = defaultdict(int)
    for track_id, accounts in wanted_by.items():
        own = by_track.get(track_id, [])
        site_sources = [each for each in own if each.kind != LIBRARY_SOURCE]
        downloaded = [each for each in site_sources if each.id in downloads]
        for account_id in accounts:
            held[account_id] += sum(downloads[each.id].size for each in downloaded)
        has_library = any(
            each.kind == LIBRARY_SOURCE and each.state == SourceState.OK for each in own
        )
        if not site_sources or downloaded or has_library:
            continue
        startable = [
            each for each in site_sources if each.kind in sites and each.state == SourceState.OK
        ]
        chosen = (startable or site_sources)[0]
        for account_id in accounts:
            held[account_id] += estimate(chosen)
        wanted.append(
            Wanted(
                track_id=track_id,
                source_id=chosen.id,
                site=chosen.kind,
                estimate=estimate(chosen),
                standing=standings[track_id],
                wanted_by=tuple(sorted(accounts)),
                source_ok=chosen.state == SourceState.OK,
                active_job=chosen.id in active,
                joined=chosen.joined,
                scratch=chosen.scratch,
                failure=_failure(
                    history.get(download_target(chosen.id), []),
                    chosen.kind,
                    accounts,
                    logins,
                    saved,
                ),
            )
        )
    disk = shutil.disk_usage(data_dir)
    state = PolicyState(
        now=now,
        limit=limit,
        free=disk.free,
        disk_size=disk.total,
        downloads=stored,
        cache=cache_copies(data_dir),
        wanted=tuple(wanted),
        reserved=sum(each.estimate for each in active.values()),
        scratch_reserved=max(
            (each.disk_bytes - each.estimate for each in active.values()), default=0
        ),
        join_tools_available=tools,
        active_policy_jobs=len(active),
        downloadable_sites=sites,
        valid_logins=frozenset(logins),
    )
    return Snapshot(
        state,
        dict(held),
        {source_id: row.file_name for source_id, row in downloads.items()},
    )


def _wanted_by(db: Session, now: datetime) -> dict[TrackId, set[AccountId]]:
    wanted: defaultdict[TrackId, set[AccountId]] = defaultdict(set)
    facts: dict[AccountId, dict[TrackId, TrackFacts]] = {}
    for playlist in db.scalars(select(PlaylistRow).where(PlaylistRow.keep_downloaded)):
        owner = AccountId(playlist.account_id)
        if playlist.rules is None:
            entries = db.scalars(
                select(PlaylistEntryRow.track_id).where(PlaylistEntryRow.playlist_id == playlist.id)
            )
            for track_id in entries:
                wanted[TrackId(track_id)].add(owner)
            continue
        try:
            rules = read_rules(playlist.rules)
        except InvalidInputError as error:
            message = f"The Playlist {playlist.name!r} keeps rules this server can't read: {error}"
            raise UnreadableRulesError(message) from None
        if owner not in facts:
            facts[owner] = track_facts(db, owner)
        seen = facts[owner]
        for track_id, each in seen.items():
            if matches(rules, each, now):
                wanted[track_id].add(owner)
    # A song is kept by keeping the file it is inside.
    for song, album in album_file_of(db).items():
        if song in wanted:
            wanted[album] |= wanted.pop(song)
    return dict(wanted)


def _standings(db: Session) -> tuple[defaultdict[TrackId, Standing], dict[TrackId, int | None]]:
    """Return how favored each Track is across every Account, and each Track's duration."""
    states: defaultdict[int, list[TrackStateRow]] = defaultdict(list)
    for row in db.scalars(select(TrackStateRow)):
        states[row.track_id].append(row)
    standings: dict[TrackId, Standing] = {}
    durations: dict[TrackId, int | None] = {}
    album_ratings = album_ratings_by_account(db)
    for track in db.scalars(select(TrackRow)):
        own = states.get(track.id, [])
        ratings = _ratings_of(track, own, album_ratings)
        played = [each.last_played_at for each in own if each.last_played_at is not None]
        standings[TrackId(track.id)] = Standing(
            favorite=any(each.favorite for each in own),
            best_rating=max(ratings, default=None),
            last_played_at=max(played, default=None),
            added_at=track.added_at,
        )
        durations[TrackId(track.id)] = track.duration_ms
    epoch = datetime.fromtimestamp(0, UTC)
    fallback = Standing(favorite=False, best_rating=None, last_played_at=None, added_at=epoch)
    return defaultdict(lambda: fallback, standings), durations


def _ratings_of(
    track: TrackRow, own: list[TrackStateRow], album_ratings: Mapping[AccountId, AlbumRatings]
) -> list[int]:
    """Return each Account's rating of a Track: its own, else its rating of the Track's album."""
    rated: dict[AccountId, int | None] = {AccountId(each.account_id): each.rating for each in own}
    for account_id, albums in album_ratings.items():
        rated[account_id] = effective_rating(
            rated.get(account_id), albums.stars_of(*library_album_of(track))
        )
    return [rating for rating in rated.values() if rating is not None]


def _valid_logins(db: Session, now: datetime) -> set[tuple[AccountId, str]]:
    return {
        (AccountId(row.account_id), row.site)
        for row in db.scalars(select(LinkedAccountRow))
        if row.state == LinkState.VALID and (row.expires_at is None or row.expires_at > now)
    }


type _Attempt = tuple[str, str | None, datetime | None]
"""A download Job's state, failure kind, and finish time."""


def _download_history(db: Session) -> dict[str, list[_Attempt]]:
    """Return each Source's download Jobs, newest first, by their target."""
    history: defaultdict[str, list[_Attempt]] = defaultdict(list)
    rows = db.execute(
        select(JobRow.target, JobRow.state, JobRow.failure_kind, JobRow.finished_at)
        .where(JobRow.kind == DOWNLOAD_KIND)
        .order_by(JobRow.id.desc())
    )
    for target, state, kind, finished_at in rows:
        history[target].append((state, kind, finished_at))
    return dict(history)


def _logins_saved(db: Session) -> dict[tuple[AccountId, str], datetime]:
    rows = db.execute(
        select(LinkedAccountRow.account_id, LinkedAccountRow.site, LinkedAccountRow.saved_at)
    )
    return {(AccountId(account_id), site): when for account_id, site, when in rows}


def _failure(
    attempts: list[_Attempt],
    site: str,
    accounts: set[AccountId],
    logins: set[tuple[AccountId, str]],
    saved: dict[tuple[AccountId, str], datetime],
) -> Failure | None:
    """Return the Source's last download failures in a row, if its last Job failed."""
    in_a_row = 0
    for state, _kind, _finished in attempts:
        if state != JobState.FAILED:
            break
        in_a_row += 1
    if not in_a_row:
        return None
    _state, kind, finished_at = attempts[0]
    failed_at = finished_at or datetime.fromtimestamp(0, UTC)
    # A login failure is cleared once an Account that wants the Track saves a valid login again.
    cleared = kind == "auth" and any(
        (account_id, site) in logins and saved.get((account_id, site), failed_at) > failed_at
        for account_id in accounts
    )
    return Failure(failed_at, in_a_row, cleared=cleared)
