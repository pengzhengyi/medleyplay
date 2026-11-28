/**
 * @file The Downloads under way, kept as the event stream tells of their Jobs.
 *
 * The list is read whole when the page loads; each `download_source` Job event then
 * moves its Download on, drops it once it ends, or, for a Job the list doesn't hold,
 * asks for the list again, since only the server knows which Track it is for.
 */

import type { DownloadStage, DownloadUnderWay, JobEvent, JobProgress } from "../api";
import type { Words } from "../locale";

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
      ...(event.failure_kind === undefined ? {} : { failure_kind: event.failure_kind }),
      failure_message: event.failure_message ?? "",
    },
  };
}

/** Say what the Download is doing, with a percentage when known. */
export function downloadStateOf(download: DownloadUnderWay, t?: Words): string {
  const { state, progress, waits_for_online, retry_at: retryAt } = download.job;
  if (state !== "running") {
    const key = waits_for_online
      ? "Waiting for Online"
      : retryAt != null
        ? "Retry scheduled"
        : "Queued";
    return t?.(key) ?? key;
  }
  if (progress === null) return t?.("Preparing download") ?? "Preparing download";
  const stage =
    progress.stage === undefined
      ? progress.message.trim() || "Downloading"
      : typedProgress(progress);
  const shown = t === undefined ? stage : stageWords(stage, t);
  if (progress.fraction === null || stage === "Checking audio") return shown;
  const percent = `${String(Math.round(progress.fraction * 100))}%`;
  return stage === "Downloading"
    ? percent
    : (t?.("{{stage}} · {{percent}}", { stage: shown, percent }) ?? `${shown} · ${percent}`);
}

function typedProgress({ stage, part, current, total }: JobProgress): string {
  if (stage === "resolve") return "Preparing download";
  if (stage === "validate") return "Checking audio";
  const action = stage === "join" ? "Joining" : "Downloading";
  return part === undefined || current === undefined || total === undefined
    ? action
    : `${action} part ${String(part)} (${String(current)}/${String(total)})`;
}

function stageWords(stage: string, t: Words): string {
  if (stage === "Downloading" || stage === "Checking audio" || stage === "Preparing download")
    return t(stage);
  const part = /^(Downloading|Joining) part (\d+)(?: \((\d+)\/(\d+)\))?$/u.exec(stage);
  if (part === null) return stage;
  const [, action, number, current, total] = part;
  if (current === undefined || total === undefined) {
    return action === "Downloading" ? t("Downloading part {{part}}", { part: number }) : stage;
  }
  return t(
    action === "Downloading"
      ? "Downloading part {{part}} ({{current}}/{{total}})"
      : "Joining part {{part}} ({{current}}/{{total}})",
    { part: number, current, total },
  );
}

const KNOWN_FAILURES: ReadonlySet<string> = new Set([
  "The download failed.",
  "The site no longer has this video.",
  "Joining several parts requires FFmpeg and ffprobe. Use Separate files instead.",
  "There is not enough temporary disk space to join this album.",
]);

export function downloadFailureOf(detail: string, t: Words): string {
  return KNOWN_FAILURES.has(detail) ? t(detail) : detail;
}

export function diagnosticStage(stage: DownloadStage, t: Words): string {
  return t(
    {
      resolve: "Resolving media",
      transfer: "Downloading",
      join: "Joining audio",
      validate: "Checking audio",
    }[stage],
  );
}

export function diagnosticReason(reason: string, status: number | null, t: Words): string {
  if (reason === "response_unknown" && status !== null) {
    return t("The provider returned unexplained HTTP {{status}}. No retry scheduled.", { status });
  }
  if (reason === "provider_refused" && status !== null) {
    return t("The provider refused the request (HTTP {{status}}). No retry scheduled.", { status });
  }
  if (reason === "network" && status !== null) {
    return t("The provider returned a temporary HTTP error ({{status}}).", { status });
  }
  return t(REASONS.get(reason) ?? "The download could not be completed.");
}

const REASONS = new Map([
  ["auth", "Bilibili refused the login."],
  ["network", "The provider could not be reached."],
  ["keychain", "The Keychain could not be read."],
  ["plugin", "The download adapter failed."],
  ["invalid", "The provider did not return usable audio."],
  ["invalid_artifact", "The download did not produce a valid audio file."],
  ["gone", "The site no longer has this video."],
  ["refused", "The download could not start or finish locally."],
  ["held", "Download held. Medleyplay will not ask the provider again."],
  ["provider_refused", "The provider refused the request. No retry scheduled."],
  ["response_unknown", "The provider returned an unclassified response. No retry scheduled."],
  [
    "attempt_uncertain",
    "The provider attempt ended without a confirmed outcome. No retry scheduled.",
  ],
  ["retry_exhausted", "Download retry limit reached."],
  ["route_changed", "The configured provider route changed. No retry scheduled."],
  ["backend_changed", "The configured download backend changed. No retry scheduled."],
  ["replaced", "A local file replaced this download."],
]);

/** Say the status in full and include any failure message the server lets this Account read. */
export function downloadDetailOf(
  download: DownloadUnderWay,
  status: string,
  presentation?: { readonly locale: string; readonly t: Words },
): string {
  const { state, failure_message: failure, retry_at: retryAt, waits_for_online } = download.job;
  const t = presentation?.t;
  if (state === "running") {
    return /^\d+%$/u.test(status)
      ? (t?.("Downloading {{percent}}", { percent: status }) ?? `Downloading ${status}`)
      : status;
  }
  if (waits_for_online) {
    return t?.("Downloading once medleyplay is Online") ?? "Downloading once medleyplay is Online";
  }
  if (retryAt == null) return t?.("Queued to download") ?? "Queued to download";
  const time = new Date(retryAt).toLocaleTimeString(presentation?.locale ?? [], {
    hour: "numeric",
    minute: "2-digit",
  });
  const retry = t?.("Retry scheduled at {{time}}", { time }) ?? `Retry scheduled at ${time}`;
  const reason = download.job.failure_kind;
  const detail = t !== undefined && reason != null ? diagnosticReason(reason, null, t) : failure;
  if (!detail) return retry;
  return t === undefined
    ? `${retry}. ${detail}`
    : t("{{status}}. {{detail}}", { status: retry, detail: downloadFailureOf(detail, t) });
}
