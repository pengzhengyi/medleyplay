/** @file The Account's open video lookups, beside its downloads. */

import { useState } from "react";
import type { SavedVideoLookup } from "../api";

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
  if (!rows.length) return null;
  return (
    <section aria-label="Video lookups">
      <h3>Video lookups</h3>
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <li>
      <div className="video-lookup-label">
        <strong>{row.label}</strong>
        <span role="status">{statusOf(row, offline)}</span>
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
          Choose parts
        </button>
      )}
      <button
        className="secondary outline"
        type="button"
        aria-busy={busy}
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError("");
          dismiss(row.id).catch((failure: unknown) => {
            setError(failure instanceof Error ? failure.message : String(failure));
            setBusy(false);
          });
        }}
      >
        Dismiss
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
