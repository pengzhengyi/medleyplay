/** @file Review missing artists and album names, with optional per-track AI requests. */

import { useEffect, useState } from "react";

import {
  type CreditCandidate,
  type MissingDetailsItem,
  type MissingDetailsPage,
  type MissingField,
  api,
} from "../api";
import { useWords } from "../locale";

const LABELS: Record<MissingField, string> = {
  artist: "Artist",
  album: "Album",
  album_artist: "Album artist",
};
const READ_EVERY_MS = 4000;

/** Read the cleanup queue only while its section is open. */
export function MissingDetails({
  revision,
  onEdit,
}: {
  readonly revision: string;
  readonly onEdit: (track: number) => void;
}) {
  const t = useWords();
  const [page, setPage] = useState<MissingDetailsPage>();
  const [cursors, setCursors] = useState<readonly number[]>([0]);
  const [changes, setChanges] = useState(0);
  const [error, setError] = useState("");
  const after = cursors.at(-1) ?? 0;
  const reload = () => {
    setChanges((count) => count + 1);
  };
  useEffect(() => {
    let active = true;
    api.missingDetails(after).then(
      (read) => {
        if (active) {
          setPage(read);
          setError("");
        }
      },
      (failure: unknown) => {
        if (active) setError(messageOf(failure));
      },
    );
    return () => {
      active = false;
    };
  }, [after, changes, revision]);
  useEffect(() => {
    if (!page?.tracks.some((track) => track.ai === "working")) return;
    const timer = setTimeout(() => {
      setChanges((count) => count + 1);
    }, READ_EVERY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [page]);

  return (
    <section className="card tidy-names" aria-labelledby="missing-details-title">
      <h3 id="missing-details-title">{t("Missing artist or album")}</h3>
      <p className="tidy-lead">
        {t("Choose a suggestion, edit the details, or leave a field blank.")}
      </p>
      {page?.tracks.some((track) =>
        ["ready", "working", "answered", "failed"].includes(track.ai),
      ) && (
        <p id="missing-details-disclosure" className="tidy-meta">
          {t(
            "Ask AI sends known music details to your enabled providers, which may be tried in turn.",
          )}
        </p>
      )}
      {error !== "" && (
        <p role="alert">
          {error}{" "}
          <button type="button" className="link-button" onClick={reload}>
            {t("Try again")}
          </button>
        </p>
      )}
      {page === undefined && error === "" && <p role="status">{t("Loading…")}</p>}
      {page?.tracks.length === 0 && <p>{t("No missing details on this page.")}</p>}
      {!!page?.tracks.length && (
        <ul className="missing-details-list">
          {page.tracks.map((track) => (
            <ReviewTrack key={track.track_id} track={track} reload={reload} onEdit={onEdit} />
          ))}
        </ul>
      )}
      {(after !== 0 || page?.next_after != null) && (
        <div className="missing-details-actions">
          <button
            type="button"
            className="secondary outline"
            disabled={after === 0}
            onClick={() => {
              setPage(undefined);
              setCursors((now) => now.slice(0, -1));
            }}
          >
            {t("Previous page")}
          </button>
          <button
            type="button"
            className="secondary outline"
            disabled={page?.next_after == null}
            onClick={() => {
              const next = page?.next_after;
              if (next != null) {
                setPage(undefined);
                setCursors((now) => [...now, next]);
              }
            }}
          >
            {t("Next page")}
          </button>
        </div>
      )}
    </section>
  );
}

function ReviewTrack({
  track,
  reload,
  onEdit,
}: {
  readonly track: MissingDetailsItem;
  readonly reload: () => void;
  readonly onEdit: (track: number) => void;
}) {
  const t = useWords();
  const [saving, setSaving] = useState("");
  const [sent, setSent] = useState<{ track: MissingDetailsItem; action: string }>();
  const [error, setError] = useState("");
  const busy = saving || (sent?.track === track ? sent.action : "");
  const askable = track.ai === "ready" || track.ai === "failed" || track.ai === "answered";
  const act = async (action: string, call: () => Promise<unknown>) => {
    setSaving(action);
    setError("");
    try {
      await call();
      setSent({ track, action });
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      reload();
      setSaving("");
    }
  };
  const decide = (field: MissingField, candidate?: CreditCandidate) =>
    act(`${field}:${candidate?.value ?? ""}`, () =>
      api.decideMissingDetail(track.track_id, track.key, field, candidate),
    );
  const hasAi = track.fields.some((detail) =>
    detail.candidates.some((item) => item.origin === "ai"),
  );
  return (
    <li className="missing-details-track">
      <h4>{track.title || t("Untitled track")}</h4>
      <p className="tidy-meta">
        {[track.kind === "album" ? t("Album file") : t("Song"), track.artist, track.album]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {track.fields.map(({ field, candidates }) => (
        <div key={field} className="missing-details-field">
          <strong>{t(LABELS[field])}</strong>
          {candidates.map((candidate) => (
            <div
              className="missing-details-candidate"
              key={`${candidate.origin}:${candidate.value}`}
            >
              <span>
                {candidate.value}{" "}
                <small className="tidy-meta">
                  {candidate.origin === "ai" ? t("Suggested by AI") : t("From your Library")}
                </small>
              </span>
              <button
                type="button"
                className="secondary outline"
                disabled={busy !== ""}
                aria-busy={busy === `${field}:${candidate.value}`}
                aria-label={t("Use {{value}} for {{field}}", {
                  value: candidate.value,
                  field: t(LABELS[field]),
                })}
                onClick={() => void decide(field, candidate)}
              >
                {t("Use")}
              </button>
            </div>
          ))}
          <button
            type="button"
            className="link-button"
            disabled={busy !== ""}
            aria-busy={busy === `${field}:`}
            aria-label={t("Leave {{field}} blank", { field: t(LABELS[field]) })}
            onClick={() => void decide(field)}
          >
            {t("Leave blank")}
          </button>
        </div>
      ))}
      <div className="missing-details-actions">
        <button
          type="button"
          className="secondary outline"
          disabled={busy !== ""}
          onClick={() => {
            onEdit(track.track_id);
          }}
        >
          {t("Edit details")}
        </button>
        {(askable || track.ai === "working" || busy === "ask") && (
          <button
            type="button"
            className="secondary outline"
            disabled={busy !== "" || track.ai === "working"}
            aria-busy={busy === "ask" || track.ai === "working"}
            aria-describedby="missing-details-disclosure"
            onClick={() => void act("ask", () => api.askMissingDetails(track.track_id, track.key))}
          >
            {track.ai === "failed" || track.ai === "answered" ? t("Ask again") : t("Ask AI")}
          </button>
        )}
      </div>
      {track.ai === "failed" && <p className="tidy-meta">{t("AI could not suggest details.")}</p>}
      {track.ai === "answered" && !hasAi && (
        <p className="tidy-meta">{t("AI had no additional suggestions.")}</p>
      )}
      {track.ai === "no_metadata" && (
        <p className="tidy-meta">{t("Not enough known music details to ask AI.")}</p>
      )}
      {error !== "" && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}
