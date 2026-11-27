/** @file The Account's open video lookups, beside its downloads. */

import { useState } from "react";
import { ApiError, type SavedVideoLookup } from "../api";
import { useWords } from "../locale";

interface Actions {
  readonly choose: (id: number) => void;
  readonly dismiss: (id: number) => Promise<void>;
  readonly offline: boolean;
}

/** Show only unresolved choices, without reading their parts until opened. */
export function VideoLookups({
  rows,
  ...actions
}: Actions & { readonly rows: readonly SavedVideoLookup[] }) {
  const t = useWords();
  if (!rows.length) return null;
  return (
    <section aria-label={t("Video lookups")}>
      <h3>{t("Video lookups")}</h3>
      <ul className="video-lookups">
        {rows.map((row) => (
          <LookupRow key={row.id} row={row} {...actions} />
        ))}
      </ul>
    </section>
  );
}

function LookupRow({
  row,
  choose,
  dismiss,
  offline,
}: Actions & { readonly row: SavedVideoLookup }) {
  const t = useWords();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ readonly cause: unknown }>();
  const active = row.state === "running" || row.state === "waiting" || row.state === "queued";
  const cause = failure?.cause;
  const detail =
    failure === undefined ? "" : cause instanceof Error ? cause.message : String(cause);
  const error =
    cause instanceof ApiError && cause.status === 404 && detail === "There is no such video lookup."
      ? t(detail)
      : detail;
  return (
    <li>
      <div className="video-lookup-label">
        <strong>{row.label}</strong>
        <span role="status">{t(statusOf(row, offline), { context: "lookup" })}</span>
        {row.state === "failed" && row.message && <span>{row.message}</span>}
      </div>
      {row.state === "succeeded" && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            choose(row.id);
          }}
        >
          {t("Choose parts")}
        </button>
      )}
      <button
        className="secondary outline"
        type="button"
        aria-busy={busy}
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setFailure(undefined);
          dismiss(row.id).catch((cause: unknown) => {
            setFailure({ cause });
            setBusy(false);
          });
        }}
      >
        {active ? t("Cancel lookup") : t("Dismiss")}
      </button>
      {error && <span role="alert">{error}</span>}
    </li>
  );
}

function statusOf(row: SavedVideoLookup, offline: boolean): string {
  switch (row.state) {
    case "succeeded":
      return "Ready";
    case "failed":
      return "Lookup failed";
    case "cancelled":
      return "Cancelled";
    default:
      if (offline) return "Waiting for Online";
      return row.state === "running" ? "Looking up…" : "Waiting";
  }
}
