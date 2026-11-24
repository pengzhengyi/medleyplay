/** @file Review missing artists and album names, with optional per-track AI requests. */

import {
  MusicNotesIcon,
  SparkleIcon,
  UserIcon,
  UsersIcon,
  VinylRecordIcon,
} from "@phosphor-icons/react";
import { useEffect, useId, useState } from "react";

import {
  type CreditCandidate,
  type MissingDetailsItem,
  type MissingDetailsPage,
  type MissingField,
  api,
} from "../api";
import { useWords } from "../locale";
import { Hint } from "./Hint";

const LABELS: Record<MissingField, string> = {
  artist: "Artist",
  album: "Album",
  album_artist: "Album artist",
};
const FIELD_ICONS = {
  artist: UserIcon,
  album: VinylRecordIcon,
  album_artist: UsersIcon,
};
const SKIP_HELP =
  "Skip keeps this field blank. To undo, remove the blank override in Edit details.";
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
      {!!page?.tracks.length && (
        <p id="missing-details-skip-help" className="tidy-meta missing-details-skip-help">
          {t(SKIP_HELP)}
        </p>
      )}
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
      <div className="missing-details-heading">
        <h4>{track.title || t("Untitled track")}</h4>
        <em className="tidy-meta">
          {[track.kind === "album" ? t("Album file") : t("Song"), track.artist, track.album]
            .filter(Boolean)
            .join(" · ")}
        </em>
      </div>
      {track.fields.map((detail) => (
        <ReviewField
          key={detail.field}
          detail={detail}
          busy={busy}
          onDecide={(candidate) => void decide(detail.field, candidate)}
          onEdit={() => {
            onEdit(track.track_id);
          }}
        />
      ))}
      {(askable || track.ai === "working" || busy === "ask") && (
        <div className="missing-details-actions">
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
        </div>
      )}
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

function ReviewField({
  detail: { field, candidates },
  busy,
  onDecide,
  onEdit,
}: {
  readonly detail: MissingDetailsItem["fields"][number];
  readonly busy: string;
  readonly onDecide: (candidate?: CreditCandidate) => void;
  readonly onEdit: () => void;
}) {
  const t = useWords();
  const group = useId();
  const [picked, setPicked] = useState<string>();
  const only = candidates.length === 1 ? candidates[0] : undefined;
  const candidate = only ?? candidates.find((item) => candidateKey(item) === picked);
  const label = t(LABELS[field]);
  const Mark = FIELD_ICONS[field];
  const actions = (
    <div className="missing-details-actions missing-details-field-actions">
      {candidates.length > 0 && (
        <button
          type="button"
          className="dialog-button missing-details-decision"
          disabled={candidate === undefined}
          aria-busy={candidate !== undefined && busy === `${field}:${candidate.value}`}
          aria-label={
            candidate === undefined
              ? t("Use")
              : t("Use {{value}} for {{field}}", {
                  value: candidate.value,
                  field: label,
                })
          }
          onClick={() => {
            if (candidate !== undefined) onDecide(candidate);
          }}
        >
          {t("Use")}
        </button>
      )}
      <button
        type="button"
        className="secondary outline dialog-button missing-details-decision"
        aria-label={t("Edit details")}
        onClick={onEdit}
      >
        {t("Edit")}
      </button>
      <Hint name={t(SKIP_HELP)} keys={[]}>
        <button
          type="button"
          className="secondary outline dialog-button missing-details-decision"
          aria-busy={busy === `${field}:`}
          aria-label={t("Skip {{field}}", { field: label })}
          aria-describedby="missing-details-skip-help"
          onClick={() => {
            onDecide();
          }}
        >
          {t("Skip")}
        </button>
      </Hint>
    </div>
  );
  return (
    <fieldset className="missing-details-field" disabled={busy !== ""}>
      <legend className={only === undefined ? undefined : "visually-hidden"}>{label}</legend>
      <div className="missing-details-field-row">
        {only !== undefined ? (
          <span className="missing-details-suggestion">
            <span className="missing-details-mark" title={label} aria-hidden>
              <Mark size={16} />
            </span>
            <span className="missing-details-candidate">{only.value}</span>
            <CandidateSource origin={only.origin} />
          </span>
        ) : candidates.length > 0 ? (
          <div className="missing-details-options">
            {candidates.map((item, index) => {
              const key = candidateKey(item);
              const source = `${group}-source-${String(index)}`;
              return (
                <div className="missing-details-option" key={key}>
                  <label className="missing-details-choice">
                    <input
                      type="radio"
                      className="missing-details-radio"
                      name={group}
                      aria-describedby={source}
                      checked={picked === key}
                      onChange={() => {
                        setPicked(key);
                      }}
                    />
                    <span className="missing-details-candidate">{item.value}</span>
                  </label>
                  <CandidateSource origin={item.origin} descriptionId={source} />
                </div>
              );
            })}
          </div>
        ) : (
          <p className="tidy-meta">{t("No suggestion yet")}</p>
        )}
        {actions}
      </div>
    </fieldset>
  );
}

function CandidateSource({
  origin,
  descriptionId,
}: {
  readonly origin: CreditCandidate["origin"];
  readonly descriptionId?: string;
}) {
  const t = useWords();
  const name = t(origin === "ai" ? "Suggested by AI" : "Already in Library");
  const Icon = origin === "ai" ? SparkleIcon : MusicNotesIcon;
  return (
    <>
      <Hint name={name} keys={[]} openOnPress>
        <button type="button" className="missing-details-source" aria-label={name}>
          <Icon size={16} aria-hidden />
        </button>
      </Hint>
      {descriptionId !== undefined && (
        <span id={descriptionId} hidden>
          {name}
        </span>
      )}
    </>
  );
}

function candidateKey(candidate: CreditCandidate): string {
  return `${candidate.origin}:${candidate.value}`;
}

function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}
