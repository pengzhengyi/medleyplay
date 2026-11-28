/** @file The private snapshot and safe, copyable receipts of a download Job. */

import { CopyIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ApiError, api, type DownloadDiagnostics, type DownloadReceipt } from "../api";
import { copyText } from "../clipboard";
import { diagnosticReason, diagnosticStage } from "../library/downloading";
import { type Words, useFormattingLocale, useWords } from "../locale";

export type DownloadDetailsTarget = { readonly job: number } | { readonly track: number };

type Read =
  | { readonly state: "loading" | "private" | "failed" }
  | { readonly state: "none"; readonly reason: string | null }
  | { readonly state: "ready"; readonly trace: DownloadDiagnostics };

const STATE_LABELS = {
  queued: "Queued to download",
  dispatched: "Attempt started",
  stage: "Download stage",
  waiting: "Waiting to download",
  running: "Downloading",
  failed: "Download failed",
  succeeded: "Download completed",
  cancelled: "Download cancelled",
} as const;

/** Show a local snapshot without polling or exposing provider messages. */
export function DownloadDetails({
  target,
  close,
}: {
  readonly target: DownloadDetailsTarget;
  readonly close: () => void;
}) {
  const t = useWords();
  const locale = useFormattingLocale();
  const title = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [read, setRead] = useState<Read>({ state: "loading" });
  const [copied, setCopied] = useState<boolean>();
  const [copying, setCopying] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
    };
  }, []);

  useEffect(() => {
    let current = true;
    void load(target).then(
      (value) => {
        if (current) setRead(value);
      },
      (error: unknown) => {
        if (current)
          setRead({
            state: error instanceof ApiError && error.status === 404 ? "private" : "failed",
          });
      },
    );
    return () => {
      current = false;
    };
  }, [target, refresh]);

  const trace = read.state === "ready" ? read.trace : undefined;
  const exportText = trace === undefined ? "" : JSON.stringify(trace, null, 2);

  return createPortal(
    <dialog
      ref={dialog}
      className="modal download-details"
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <article className="card modal-frame">
        <header>
          <button
            type="button"
            className="icon modal-close"
            aria-label={t("Close")}
            title={t("Close")}
            onClick={close}
          >
            <XIcon aria-hidden />
          </button>
          <h2 id={title}>{t("Download details")}</h2>
        </header>
        {read.state === "loading" && <p role="status">{t("Loading download details…")}</p>}
        {read.state === "none" && (
          <p>
            {read.reason === null
              ? t("No download attempt has been recorded.")
              : diagnosticReason(read.reason, null, t)}
          </p>
        )}
        {read.state === "private" && (
          <p>{t("Only the requester or an admin can see this trace.")}</p>
        )}
        {read.state === "failed" && <p role="alert">{t("Could not read the download details.")}</p>}
        {trace !== undefined && (
          <>
            <p>
              <strong>{t("Job {{id}}", { id: trace.job_id })}</strong>
              {" · "}
              {t(STATE_LABELS[trace.state])}
              {" · "}
              {t("{{used}} of {{max}} attempts started", {
                used: trace.attempts,
                max: trace.max_attempts,
              })}
            </p>
            <p>{t(trace.has_saved_audio ? "Saved audio available" : "No saved audio")}</p>
            {trace.waits_for_online && <p>{t("Waiting for Online")}</p>}
            {trace.hold !== null ? (
              <p>
                {diagnosticReason(
                  trace.hold,
                  trace.reason === trace.hold ? trace.http_status : null,
                  t,
                )}
              </p>
            ) : trace.reason !== null ? (
              <p>{diagnosticReason(trace.reason, trace.http_status, t)}</p>
            ) : null}
            {trace.retry_at !== null && (
              <p>
                {t("Retry scheduled at {{time}}", { time: formatTime(trace.retry_at, locale) })}
              </p>
            )}
            {trace.events.length === 0 ? (
              <p>{t("No retained events for this job.")}</p>
            ) : (
              <ol className="download-receipts">
                {trace.events.map((entry) => (
                  <li key={entry.sequence}>
                    <time dateTime={entry.at}>{formatTime(entry.at, locale)}</time>
                    {" · "}
                    {receiptOf(entry, t)}
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
        {copied === false && (
          <label>
            {t("Could not copy. Select and copy the diagnostics manually.")}
            <textarea
              readOnly
              value={exportText}
              onFocus={(event) => {
                event.currentTarget.select();
              }}
            />
          </label>
        )}
        <footer className="dialog-buttons">
          {(read.state === "ready" || read.state === "failed") && (
            <button
              type="button"
              className="secondary outline dialog-button"
              onClick={() => {
                setRead({ state: "loading" });
                setCopied(undefined);
                setRefresh((value) => value + 1);
              }}
            >
              {t("Refresh details")}
            </button>
          )}
          {trace !== undefined && (
            <button
              type="button"
              className="dialog-button"
              disabled={copying}
              aria-busy={copying}
              onClick={() => {
                setCopying(true);
                void copyText(exportText).then((worked) => {
                  setCopied(worked);
                  setCopying(false);
                });
              }}
            >
              <CopyIcon aria-hidden /> {t("Copy diagnostics")}
            </button>
          )}
          {copied === true && <span role="status">{t("Diagnostics copied.")}</span>}
        </footer>
      </article>
    </dialog>,
    document.body,
  );
}

async function load(target: DownloadDetailsTarget): Promise<Read> {
  let job: number | null;
  if ("job" in target) {
    job = target.job;
  } else {
    const download = await api.download(target.track);
    job = download.latest_job_id ?? download.job_id;
    if (job === null) {
      return {
        state: "none",
        reason: download.hold ?? (download.status === "unavailable" ? "gone" : null),
      };
    }
  }
  return { state: "ready", trace: await api.downloadDiagnostics(job) };
}

function receiptOf(entry: DownloadReceipt, t: Words): string {
  const summary =
    entry.stage === null ? t(STATE_LABELS[entry.event]) : diagnosticStage(entry.stage, t);
  return [
    entry.attempt === null ? "" : t("Attempt {{number}}", { number: entry.attempt }),
    summary,
    entry.part === null ? "" : t("Part {{number}}", { number: entry.part }),
    entry.route === null
      ? ""
      : t(
          entry.route === "direct"
            ? "Configured route: Direct (egress not measured)"
            : "Configured route: Site proxy (egress not measured)",
        ),
    entry.reason === null ? "" : diagnosticReason(entry.reason, entry.http_status, t),
  ]
    .filter(Boolean)
    .join(" · ");
}

function formatTime(at: string, locale: string): string {
  return new Date(at).toLocaleString(locale, { dateStyle: "short", timeStyle: "medium" });
}
