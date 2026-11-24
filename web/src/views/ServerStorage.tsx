/** @file An admin's overview of managed files, separate from the Download limit. */

import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState } from "react";

import { type StorageInspection, api } from "../api";
import { formatBytes } from "../format";
import { Hint } from "./Hint";
import { StorageFolderLocation } from "./StorageFolderLocation";
import { useStorageLegend } from "./useStorageLegend";

const categories = [
  ["downloads", "Download files"],
  ["cache", "Prepared audio cache"],
  ["covers", "Original artwork"],
  ["database", "SQLite database"],
  ["thumbnails", "Artwork thumbnails"],
  ["database_companions", "SQLite journals and shared memory"],
  ["configuration", "Configuration file"],
] as const;

type StorageCategory = (typeof categories)[number][0];
interface StoragePart {
  readonly key: StorageCategory;
  readonly label: string;
  readonly bytes: number;
  readonly share: number;
}

const percent = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 1 });
const smallestShare = 0.001;

export function ServerStorage() {
  const [expanded, setExpanded] = useState(false);
  const legend = useStorageLegend<StorageCategory>();
  const [report, setReport] = useState<StorageInspection>();
  const [status, setStatus] = useState<"idle" | "measuring" | "failed">("measuring");
  const [revision, setRevision] = useState(0);
  const request = useRef<Promise<StorageInspection> | undefined>(undefined);
  const id = useId();
  const panel = `${id}-panel`;
  const summary = `${id}-summary`;
  const busy = status === "measuring";
  const outdated = report !== undefined && status !== "idle";
  const total = report ? categories.reduce((sum, [key]) => sum + report[key], 0) : 0;
  const parts: readonly StoragePart[] = report
    ? categories.map(([key, label]) => ({
        key,
        label,
        bytes: report[key],
        share: total === 0 ? 0 : report[key] / total,
      }))
    : [];

  useEffect(() => {
    let current = true;
    request.current ??= api.inspectStorage();
    void request.current.then(
      (measured) => {
        if (current) {
          setReport(measured);
          setStatus("idle");
        }
      },
      () => {
        if (current) {
          setStatus("failed");
        }
      },
    );
    return () => {
      current = false;
    };
  }, [revision]);

  function refresh() {
    request.current = undefined;
    setStatus("measuring");
    setRevision((value) => value + 1);
  }

  function toggle() {
    legend.clear();
    setExpanded((open) => !open);
  }

  return (
    <section
      className="storage-inspection"
      data-outdated={outdated || undefined}
      aria-label="Server storage"
    >
      <div className="storage-composition-heading">
        <h4>Server storage</h4>
        <button
          type="button"
          className="secondary outline storage-inspect"
          aria-label={expanded ? "Hide storage composition" : "Inspect server storage"}
          aria-expanded={expanded}
          aria-controls={panel}
          onClick={toggle}
        >
          {expanded ? "Hide details" : "Inspect"}
        </button>
      </div>
      <p className="usage-total" id={summary}>
        {report ? (
          <>
            <strong>{formatBytes(total)}</strong> occupied by managed files
            {outdated && <span className="storage-outdated">Outdated</span>}
          </>
        ) : (
          <span className="hint">
            {status === "failed" ? "Occupied space unavailable" : "Occupied space"}
          </span>
        )}
      </p>
      <button
        type="button"
        className="storage-meter-button"
        aria-label="Occupied space"
        aria-describedby={summary}
        aria-expanded={expanded}
        aria-controls={panel}
        onClick={toggle}
      >
        <span
          className="meter storage-composition-meter"
          data-highlighting={
            parts.some(({ key, bytes }) => legend.active === key && bytes > 0) || undefined
          }
          aria-hidden
        >
          {parts
            .filter(({ bytes }) => bytes > 0)
            .map(({ key, share }) => (
              <span
                key={key}
                data-storage={key}
                data-highlighted={legend.active === key || undefined}
                style={{ width: `${String(share * 100)}%` }}
              />
            ))}
        </span>
      </button>
      <StorageFolderLocation scope="server" />
      <p className="hint" role="status">
        {busy ? "Measuring server storage…" : ""}
      </p>
      {status === "failed" && (
        <p role="alert">Could not measure storage. Check server access and try again.</p>
      )}
      {status === "failed" && !report && (
        <button type="button" className="secondary outline storage-inspect" onClick={refresh}>
          Retry
        </button>
      )}
      <section
        id={panel}
        className="storage-panel"
        aria-label="Storage composition"
        hidden={!expanded}
      >
        {report && expanded && (
          <>
            <div className="storage-composition-heading">
              <h5>Storage composition</h5>
              <Hint name="Refresh server storage" keys={[]}>
                <button
                  type="button"
                  className="icon"
                  aria-label="Refresh server storage"
                  disabled={busy}
                  aria-busy={busy}
                  onClick={refresh}
                >
                  <ArrowClockwiseIcon className={busy ? "spin" : undefined} aria-hidden />
                </button>
              </Hint>
            </div>
            <Composition parts={parts} legend={legend} />
            <StartupSettings report={report} />
          </>
        )}
      </section>
    </section>
  );
}

function Composition({
  parts,
  legend,
}: {
  readonly parts: readonly StoragePart[];
  readonly legend: ReturnType<typeof useStorageLegend<StorageCategory>>;
}) {
  return (
    <>
      <dl className="legend storage-composition-legend">
        {parts.map(({ key, label, bytes, share }) => (
          <div key={key} {...legend.entry(key)}>
            <dt>
              <span className="swatch" data-storage={key} aria-hidden />
              {key === "database" || key === "database_companions" ? (
                <Hint name={label} keys={[]}>
                  <span className="storage-label-cut" tabIndex={0}>
                    {label}
                  </span>
                </Hint>
              ) : (
                <span tabIndex={0}>{label}</span>
              )}
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
  const id = useId();
  const flags = [
    ["Multiple accounts", report.multiple_accounts, "Lets different people sign in separately."],
    ["Plugin safe mode", report.safe_mode, "Starts the server without loading plugins."],
    [
      "SQLite write-ahead logging",
      report.wal_enabled,
      "SQLite can create separate journal and shared-memory files for recent writes.",
    ],
  ] as const;
  return (
    <div className="storage-startup">
      <h6 id={id}>Server settings at startup</h6>
      <p className="hint">Read only. These settings do not change the Download limit.</p>
      <ul className="storage-flags" aria-labelledby={id}>
        {flags.map(([label, enabled, description], index) => {
          const descriptionId = `${id}-${String(index)}`;
          return (
            <li key={label}>
              <label className="storage-flag">
                <input type="radio" checked={enabled} disabled aria-describedby={descriptionId} />
                {label}
              </label>
              <span className="storage-flag-state">{enabled ? "On" : "Off"}</span>
              <p id={descriptionId} className="hint">
                {description}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
