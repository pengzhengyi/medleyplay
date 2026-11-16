/**
 * @file The Downloads under way, kept as the event stream tells of their Jobs.
 *
 * The list is read whole when the page loads; each `download_source` Job event then
 * moves its Download on, drops it once it ends, or, for a Job the list doesn't hold,
 * asks for the list again, since only the server knows which Track it is for.
 */

import type { DownloadUnderWay, JobEvent } from "../api";

/** The kind of Job that downloads a Source. */
export const DOWNLOAD_KIND = "download_source";

const ACTIVE: ReadonlySet<JobEvent["state"]> = new Set(["waiting", "queued", "running"]);

/** Return whether `job` is a Download's Job that has ended, however it ended. */
export function downloadEnded(job: JobEvent): boolean {
  return job.kind === DOWNLOAD_KIND && !ACTIVE.has(job.state);
}

/**
 * Return the Downloads under way once `job` is told of: `next`, and whether the list
 * must be read again, for a Download it doesn't hold yet.
 */
export function followDownload(
  now: readonly DownloadUnderWay[],
  job: JobEvent,
): { readonly next: readonly DownloadUnderWay[]; readonly reread: boolean } {
  if (job.kind !== DOWNLOAD_KIND) {
    return { next: now, reread: false };
  }
  const held = now.some((each) => each.job.id === job.id);
  if (!ACTIVE.has(job.state)) {
    return { next: held ? now.filter((each) => each.job.id !== job.id) : now, reread: false };
  }
  if (!held) {
    return { next: now, reread: true };
  }
  return {
    next: now.map((each) =>
      each.job.id === job.id
        ? {
            ...each,
            job: {
              ...each.job,
              state: job.state,
              progress: job.progress ?? null,
              waits_for_online: job.waits_for_online ?? each.job.waits_for_online,
            },
          }
        : each,
    ),
    reread: false,
  };
}

/** Say how far a Download has got, in a word or two: *Waiting for Online*, *42%*. */
export function downloadStateOf(download: DownloadUnderWay): string {
  const { state, progress, waits_for_online } = download.job;
  if (state !== "running") {
    return waits_for_online ? "Waiting for Online" : "Waiting";
  }
  const fraction = progress?.fraction ?? null;
  return fraction === null ? "Downloading" : `${String(Math.round(fraction * 100))}%`;
}
