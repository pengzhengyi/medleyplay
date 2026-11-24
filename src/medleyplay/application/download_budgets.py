"""Account for Download reservations and the transient space needed to join parts."""

import shutil
import stat
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from medleyplay.application.settings import read_settings
from medleyplay.domain.catalog import SourceId
from medleyplay.domain.downloads import (
    DOWNLOAD_KIND,
    JOIN_ESTIMATE_DETAIL,
    JOIN_LANE,
    JOIN_SCRATCH_BYTES,
    QUALITY_DETAIL,
    quality_kbps,
    source_of_target,
)
from medleyplay.domain.jobs import ACTIVE_STATES
from medleyplay.domain.playback import CACHE_FOLDER
from medleyplay.domain.policy import MIN_FREE, MIN_FREE_SHARE, CacheCopy, reservation
from medleyplay.persistence.schema import DownloadRow, JobRow, SourceRow, TrackRow


@dataclass(frozen=True)
class DownloadBudget:
    """The bytes counted toward the Download limit and the peak space on disk."""

    estimate: int
    scratch: int = 0

    @property
    def disk_bytes(self) -> int:
        """Return the largest space this Download needs at any stage."""
        return max(self.estimate, self.scratch)


def estimate_of(details: dict[str, object] | None, duration_ms: int | None) -> int:
    """Use the per-part joined estimate, or the duration and quality of a standalone part."""
    data = details or {}
    joined = data.get(JOIN_ESTIMATE_DETAIL)
    if isinstance(joined, int) and not isinstance(joined, bool) and joined > 0:
        return joined
    return reservation(duration_ms, quality_kbps(str(data.get(QUALITY_DETAIL, "best"))))


def active_budgets(db: Session) -> dict[SourceId, DownloadBudget]:
    """Read the download estimates outstanding for Sources with an active Job."""
    jobs = {
        source_id: row.request.get("lane") == JOIN_LANE
        for row in db.scalars(
            select(JobRow).where(JobRow.kind == DOWNLOAD_KIND, JobRow.state.in_(ACTIVE_STATES))
        )
        if (source_id := source_of_target(row.target)) is not None
    }
    if not jobs:
        return {}
    return {
        SourceId(source_id): DownloadBudget(
            estimate_of(details, duration), JOIN_SCRATCH_BYTES if jobs[SourceId(source_id)] else 0
        )
        for source_id, details, duration in db.execute(
            select(SourceRow.id, SourceRow.details, TrackRow.duration_ms)
            .join(TrackRow, SourceRow.track_id == TrackRow.id)
            .where(SourceRow.id.in_(jobs))
        )
    }


def cache_copies(data_dir: Path) -> tuple[CacheCopy, ...]:
    """Read prepared audio sizes, skipping copies that disappeared before they were read."""
    folder = data_dir / CACHE_FOLDER
    if not folder.is_dir():
        return ()
    copies = []
    for path in folder.iterdir():
        try:
            info = path.lstat()
        except FileNotFoundError:
            continue
        if stat.S_ISREG(info.st_mode):
            touched = datetime.fromtimestamp(max(info.st_atime, info.st_mtime), UTC)
            copies.append(CacheCopy(path.name, info.st_size, touched))
    return tuple(copies)


def limit_refusal(db: Session, data_dir: Path, source: SourceId, needed: int) -> str | None:
    """Give the reason a joined result cannot fit, not counting its own reservation."""
    limit = read_settings(db).storage_limit
    if limit is None:
        return None
    used = db.scalar(select(func.sum(DownloadRow.size))) or 0
    used += sum(each.size for each in cache_copies(data_dir))
    used += sum(each.estimate for key, each in active_budgets(db).items() if key != source)
    return "The joined album would exceed the Download limit." if used + needed > limit else None


def disk_refusal(
    db: Session, data_dir: Path, source: SourceId, budget: DownloadBudget, *, starting: bool
) -> str | None:
    """Check the disk floor beyond pending downloads and the album's working files."""
    disk = shutil.disk_usage(data_dir)
    floor = max(MIN_FREE, int(disk.total * MIN_FREE_SHARE))
    others = [each for key, each in active_budgets(db).items() if key != source]
    reserved = sum(each.estimate for each in others)
    scratch = (
        0
        if starting and budget.scratch
        else max((each.disk_bytes - each.estimate for each in others), default=0)
    )
    if disk.free - floor - reserved < max(budget.disk_bytes, budget.estimate + scratch):
        return "There is not enough temporary disk space to download this joined album."
    return None
