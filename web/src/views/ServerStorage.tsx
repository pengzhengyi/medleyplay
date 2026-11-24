/** @file An admin's on-demand measurement of managed files, separate from the Download limit. */

import { ArrowClockwiseIcon, GearSixIcon } from "@phosphor-icons/react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { useState } from "react";

import { type StorageInspection, api } from "../api";
import { formatBytes } from "../format";
import { Hint } from "./Hint";

const categories = [
  ["downloads", "Download files"],
  ["cache", "Prepared audio cache"],
  ["covers", "Original artwork"],
  ["thumbnails", "Artwork thumbnails"],
  ["database", "SQLite database"],
  ["database_companions", "SQLite journals and shared memory"],
  ["configuration", "Configuration file"],
] as const;

const percent = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 1 });
const smallestShare = 0.001;

export function ServerStorage() {
  const [report, setReport] = useState<StorageInspection>();
  const [status, setStatus] = useState<"idle" | "measuring" | "failed">("idle");
  const busy = status === "measuring";
  const outdated = report !== undefined && status !== "idle";
  const total = report ? categories.reduce((sum, [key]) => sum + report[key], 0) : 0;
  const action = report ? "Refresh server storage" : "Inspect server storage";

  async function inspect() {
    setStatus("measuring");
    try {
      setReport(await api.inspectStorage());
      setStatus("idle");
    } catch {
      setStatus("failed");
    }
  }

  return (
    <section
      className="storage-inspection storage-composition"
      data-outdated={outdated || undefined}
      aria-label={report ? "Storage composition" : "Server storage"}
    >
      <div className="storage-composition-heading">
        {report ? (
          <p className="usage-total">
            <strong>{formatBytes(total)}</strong> in managed files
            {outdated && <span className="storage-outdated">Outdated</span>}
          </p>
        ) : (
          <h4>Server storage</h4>
        )}
        <div className="storage-composition-actions">
          <Hint name={action} keys={[]}>
            <button
              type="button"
              className={report ? "icon" : "secondary outline storage-inspect"}
              aria-label={action}
              disabled={busy}
              aria-busy={busy}
              onClick={() => void inspect()}
            >
              {report ? (
                <ArrowClockwiseIcon className={busy ? "spin" : undefined} aria-hidden />
              ) : (
                "Inspect"
              )}
            </button>
          </Hint>
          {report && <StartupSettings report={report} />}
        </div>
      </div>
      <p className="hint" role="status">
        {busy ? "Measuring server storage…" : ""}
      </p>
      {status === "failed" && (
        <p role="alert">Could not measure storage. Check server access and try again.</p>
      )}
      {report && <Composition report={report} total={total} />}
    </section>
  );
}

function Composition({
  report,
  total,
}: {
  readonly report: StorageInspection;
  readonly total: number;
}) {
  const parts = categories.map(([key, label]) => ({
    key,
    label,
    bytes: report[key],
    share: total === 0 ? 0 : report[key] / total,
  }));
  return (
    <>
      <div className="meter storage-composition-meter" aria-hidden>
        {parts
          .filter(({ bytes }) => bytes > 0)
          .map(({ key, share }) => (
            <span key={key} data-storage={key} style={{ width: `${String(share * 100)}%` }} />
          ))}
      </div>
      <dl className="legend storage-composition-legend">
        {parts.map(({ key, label, bytes, share }) => (
          <div key={key}>
            <dt>
              <span className="swatch" data-storage={key} aria-hidden />
              {label}
            </dt>
            <dd>
              {formatBytes(bytes)}{" "}
              <span className="storage-share">
                {share > 0 && share < smallestShare
                  ? `<${percent.format(smallestShare)}`
                  : percent.format(share)}
              </span>
            </dd>
          </div>
        ))}
      </dl>
      <p className="hint">
        File lengths, not space allocated on disk. Excludes reservations, job folders and library
        originals. Measurements are reused for one minute.
      </p>
    </>
  );
}

function StartupSettings({ report }: { readonly report: StorageInspection }) {
  const [open, setOpen] = useState(false);
  const title = "Server settings at startup";
  const flags = [
    ["Multiple accounts", report.multiple_accounts ? "on" : "off"],
    ["Plugin safe mode", report.safe_mode ? "on" : "off"],
    ["SQLite write-ahead logging", report.wal_enabled ? "on" : "off"],
  ] as const;
  return (
    <Tooltip.Provider delayDuration={200}>
      <Tooltip.Root open={open} onOpenChange={setOpen}>
        <Tooltip.Trigger
          type="button"
          className="icon"
          aria-label={title}
          onClick={(event) => {
            event.preventDefault();
            setOpen(true);
          }}
        >
          <GearSixIcon aria-hidden />
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            className="control-hint storage-settings-tip"
            side="top"
            align="end"
            sideOffset={6}
            collisionPadding={8}
            aria-label={flags.map(([label, state]) => `${label}: ${state}`).join("; ")}
          >
            <strong>{title}</strong>
            <dl>
              {flags.map(([label, state]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{state}</dd>
                </div>
              ))}
            </dl>
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
