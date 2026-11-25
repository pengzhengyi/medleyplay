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
    next: now.map((each) => (each.job.id === job.id ? withDownloadEvent(each, job) : each)),
    reread: false,
  };
}

/** Apply the latest event to the Download for that Job. */
export function withDownloadEvent(download: DownloadUnderWay, event: JobEvent): DownloadUnderWay {
  return {
    ...download,
    job: {
      ...download.job,
      state: event.state,
      progress: event.progress ?? null,
      waits_for_online: event.waits_for_online ?? download.job.waits_for_online,
      retry_at: event.retry_at ?? null,
      failure_message: event.failure_message ?? "",
    },
  };
}

/** Say what the Download is doing, with a percentage when known. */
export function downloadStateOf(download: DownloadUnderWay): string {
  const { state, progress, waits_for_online, retry_at: retryAt } = download.job;
  if (state !== "running") {
    if (waits_for_online) return "Waiting for Online";
    return retryAt != null ? "Retry scheduled" : "Queued";
  }
  if (progress === null) return "Preparing download";
  const stage = progress.message.trim() || "Downloading";
  if (progress.fraction === null || stage === "Checking audio") return stage;
  const percent = `${String(Math.round(progress.fraction * 100))}%`;
  return stage === "Downloading" ? percent : `${stage} · ${percent}`;
}

/** Say the status in full and include any failure message the server lets this Account read. */
export function downloadDetailOf(download: DownloadUnderWay, status: string): string {
  const { state, failure_message: failure, retry_at: retryAt, waits_for_online } = download.job;
  if (state === "running") return /^\d+%$/u.test(status) ? `Downloading ${status}` : status;
  if (waits_for_online) return "Downloading once medleyplay is Online";
  if (retryAt == null) return "Queued to download";
  const time = new Date(retryAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const retry = `Retry scheduled at ${time}`;
  return failure ? `${retry}. ${failure}` : retry;
}
