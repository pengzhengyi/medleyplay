/**
 * @file Adding a video from Bilibili: its parts with a title and artist each, or, for a
 * video that couldn't be read, the household's own details for the parts.
 *
 * Escape, Cancel, or a click outside close it without adding anything.
 */

import { PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { type SubmitEvent, useEffect, useEffectEvent, useRef, useState } from "react";

import type { AddedPart, LinkLookup, PartChoice } from "../api";
import { partLink } from "../library/otherWays";
import { suggestedArtist, suggestedTitle } from "../library/suggest";
import { Modal } from "./Modal";
import { OtherWays } from "./OtherWays";

/** The most parts one add takes, as the server has it. */
const MAX_PARTS = 50;
const MAX_PART_NUMBER = 9999;
const BEST = "best";
const WHY: Record<string, string> = {
  gone: "The site no longer has this video.",
  needs_login: "Only a signed-in account can see this video.",
  network: "The site couldn’t be reached.",
  refused: "The site refused to show this video.",
  fault: "Reading the video failed.",
};

/** The step the dialog is at: asking the site, refused, or the video read. */
type Step =
  | { readonly state: "looking" }
  | { readonly state: "failed"; readonly message: string }
  | { readonly state: "read"; readonly lookup: LinkLookup };

/**
 * Add the video `link` names: `look` asks for its details, and `add` adds the parts
 * chosen, at the quality, as Tracks; `onAdded` hears how many were added.
 */
export function AddLink({
  link,
  look,
  add,
  onAdded,
  onClose,
}: {
  readonly link: string;
  readonly look: (link: string) => Promise<LinkLookup>;
  readonly add: (
    link: string,
    quality: string,
    parts: readonly PartChoice[],
  ) => Promise<readonly AddedPart[]>;
  readonly onAdded: (count: number) => void;
  readonly onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState<Step>({ state: "looking" });
  const lookUp = useEffectEvent(look);
  useEffect(() => {
    let current = true;
    lookUp(link).then(
      (lookup) => {
        if (current) {
          setStep({ state: "read", lookup });
        }
      },
      (failure: unknown) => {
        if (current) {
          setStep({
            state: "failed",
            message: failure instanceof Error ? failure.message : String(failure),
          });
        }
      },
    );
    return () => {
      current = false;
    };
  }, [link]);
  const close = () => {
    dialog.current?.close();
  };
  const finish = (added: readonly AddedPart[]) => {
    onAdded(added.length);
    close();
  };

  return (
    <Modal ref={dialog} className="add-link" labelledBy="add-link-title" onClose={onClose}>
      <div className="card">
        <h2 id="add-link-title">Add from Bilibili</h2>
        {step.state === "looking" && (
          <p className="empty" aria-busy="true">
            Looking the video up…
          </p>
        )}
        {step.state === "failed" && (
          <>
            <p className="error" role="alert">
              {step.message}
            </p>
            <footer className="dialog-buttons">
              <button type="button" className="secondary dialog-button" onClick={close}>
                Close
              </button>
            </footer>
          </>
        )}
        {step.state === "read" &&
          (step.lookup.readable ? (
            <ReadVideo
              link={link}
              lookup={step.lookup}
              add={add}
              onAdded={finish}
              onCancel={close}
            />
          ) : (
            <UnreadableVideo
              link={link}
              lookup={step.lookup}
              add={add}
              onAdded={finish}
              onCancel={close}
            />
          ))}
      </div>
    </Modal>
  );
}

interface FormProps {
  readonly link: string;
  readonly lookup: LinkLookup;
  readonly add: (
    link: string,
    quality: string,
    parts: readonly PartChoice[],
  ) => Promise<readonly AddedPart[]>;
  readonly onAdded: (added: readonly AddedPart[]) => void;
  readonly onCancel: () => void;
}

/** What the household is told while a form saves, or why it didn't. */
function useSaving(onAdded: (added: readonly AddedPart[]) => void) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async (send: () => Promise<readonly AddedPart[]>) => {
    setSaving(true);
    setError("");
    try {
      onAdded(await send());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setSaving(false);
    }
  };
  return { saving, error, save };
}

interface Row {
  readonly part: number;
  readonly title: string;
  readonly artist: string;
  readonly chosen: boolean;
  readonly taken: boolean;
}

function ReadVideo({ link, lookup, add, onAdded, onCancel }: FormProps) {
  const [rows, setRows] = useState<readonly Row[]>(() => {
    let room = MAX_PARTS;
    return lookup.parts.map((part) => {
      const chosen = part.track_id === null && room > 0;
      room -= chosen ? 1 : 0;
      return {
        part: part.part,
        title: suggestedTitle(lookup, part),
        artist: suggestedArtist(lookup),
        chosen,
        taken: part.track_id !== null,
      };
    });
  });
  const [quality, setQuality] = useState(BEST);
  const { saving, error, save } = useSaving(onAdded);
  const chosen = rows.filter((row) => row.chosen);
  const change = (part: number, changes: Partial<Row>) => {
    setRows((now) => now.map((row) => (row.part === part ? { ...row, ...changes } : row)));
  };
  const complete = chosen.length > 0 && chosen.every((row) => row.title.trim() !== "");
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    void save(() =>
      add(
        link,
        quality,
        chosen.map(({ part, title, artist }) => ({ part, title: title.trim(), artist })),
      ),
    );
  };

  return (
    <form onSubmit={submit}>
      <p className="add-link-video">
        <strong>{lookup.title}</strong>
        <span className="add-link-uploader">{lookup.uploader}</span>
      </p>
      <ul className="parts">
        {rows.map((row) => (
          <li key={row.part} className="part">
            <label className="part-choice">
              <input
                type="checkbox"
                className="part-box"
                checked={row.chosen}
                disabled={row.taken}
                onChange={(event) => {
                  change(row.part, { chosen: event.currentTarget.checked });
                }}
              />
              <span>
                Part {row.part}
                {row.taken && <span className="choice-meta"> Already added</span>}
              </span>
            </label>
            {!row.taken && (
              <div className="part-fields">
                <input
                  type="text"
                  className="part-input"
                  aria-label={`Title of part ${String(row.part)}`}
                  value={row.title}
                  maxLength={512}
                  disabled={!row.chosen}
                  onChange={(event) => {
                    change(row.part, { title: event.currentTarget.value });
                  }}
                />
                <input
                  type="text"
                  className="part-input"
                  aria-label={`Artist of part ${String(row.part)}`}
                  value={row.artist}
                  maxLength={512}
                  disabled={!row.chosen}
                  onChange={(event) => {
                    change(row.part, { artist: event.currentTarget.value });
                  }}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
      <label className="quality">
        Quality
        <select
          className="quality-select"
          value={quality}
          onChange={(event) => {
            setQuality(event.currentTarget.value);
          }}
        >
          <option value={BEST}>Best available</option>
          {lookup.qualities.map((each) => (
            <option key={each.id} value={each.id}>
              {each.label}
            </option>
          ))}
        </select>
      </label>
      <OtherWays kind={lookup.kind} link={partLink(lookup.kind, lookup.video, firstOf(rows))} />
      <Footer error={error} saving={saving} disabled={!complete} onCancel={onCancel}>
        {chosen.length <= 1 ? "Add" : `Add ${String(chosen.length)} songs`}
      </Footer>
    </form>
  );
}

function firstOf(rows: readonly Row[]): number {
  return (rows.find((row) => row.chosen) ?? rows[0])?.part ?? 1;
}

interface Draft {
  readonly key: number;
  readonly part: string;
  readonly title: string;
  readonly artist: string;
}

function UnreadableVideo({ link, lookup, add, onAdded, onCancel }: FormProps) {
  const first = lookup.parts[0]?.part ?? 1;
  const [drafts, setDrafts] = useState<readonly Draft[]>([
    { key: 0, part: String(first), title: "", artist: "" },
  ]);
  const { saving, error, save } = useSaving(onAdded);
  const change = (key: number, changes: Partial<Draft>) => {
    setDrafts((now) => now.map((draft) => (draft.key === key ? { ...draft, ...changes } : draft)));
  };
  const numbers = drafts.map((draft) => Number(draft.part));
  const complete =
    drafts.every((draft) => draft.title.trim() !== "") &&
    numbers.every((n) => Number.isInteger(n) && n >= 1 && n <= MAX_PART_NUMBER) &&
    new Set(numbers).size === numbers.length;
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    void save(() =>
      add(
        link,
        BEST,
        drafts.map((draft) => ({
          part: Number(draft.part),
          title: draft.title.trim(),
          artist: draft.artist,
        })),
      ),
    );
  };

  return (
    <form onSubmit={submit}>
      <p className="error" role="alert">
        {WHY[lookup.reason ?? "fault"]} {lookup.message}
      </p>
      <p className="add-link-explain">
        You can still add it. Give each part a title and an artist; medleyplay will try to download
        it, and you can add the file yourself if that fails. It is added at the best quality.
      </p>
      <ul className="parts">
        {drafts.map((draft, index) => (
          <li key={draft.key} className="part">
            <div className="part-fields numbered">
              <input
                type="number"
                className="part-input part-number"
                min={1}
                max={MAX_PART_NUMBER}
                aria-label={`Part number ${String(index + 1)}`}
                value={draft.part}
                onChange={(event) => {
                  change(draft.key, { part: event.currentTarget.value });
                }}
              />
              <input
                type="text"
                className="part-input"
                aria-label={`Title of part ${String(index + 1)}`}
                value={draft.title}
                maxLength={512}
                onChange={(event) => {
                  change(draft.key, { title: event.currentTarget.value });
                }}
              />
              <input
                type="text"
                className="part-input"
                aria-label={`Artist of part ${String(index + 1)}`}
                value={draft.artist}
                maxLength={512}
                onChange={(event) => {
                  change(draft.key, { artist: event.currentTarget.value });
                }}
              />
              {drafts.length > 1 && (
                <button
                  type="button"
                  className="icon"
                  aria-label={`Remove part ${String(index + 1)}`}
                  title="Remove"
                  onClick={() => {
                    setDrafts((now) => now.filter((each) => each.key !== draft.key));
                  }}
                >
                  <TrashIcon weight="regular" aria-hidden />
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {drafts.length < MAX_PARTS && (
        <button
          type="button"
          className="secondary outline dialog-button add-part"
          onClick={() => {
            setDrafts((now) => [
              ...now,
              {
                key: Math.max(...now.map((each) => each.key)) + 1,
                part: String(Math.max(...now.map((each) => Number(each.part) || 0)) + 1),
                title: "",
                artist: now.at(-1)?.artist ?? "",
              },
            ]);
          }}
        >
          <PlusIcon weight="bold" aria-hidden />
          Add another part
        </button>
      )}
      <OtherWays kind={lookup.kind} link={partLink(lookup.kind, lookup.video, first)} />
      <Footer error={error} saving={saving} disabled={!complete} onCancel={onCancel}>
        {drafts.length === 1 ? "Add" : `Add ${String(drafts.length)} songs`}
      </Footer>
    </form>
  );
}

function Footer({
  error,
  saving,
  disabled,
  onCancel,
  children,
}: {
  readonly error: string;
  readonly saving: boolean;
  readonly disabled: boolean;
  readonly onCancel: () => void;
  readonly children: string;
}) {
  return (
    <>
      {error !== "" && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <footer className="dialog-buttons">
        <button type="button" className="secondary outline dialog-button" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="submit"
          className="dialog-button"
          disabled={disabled || saving}
          aria-busy={saving}
        >
          {children}
        </button>
      </footer>
    </>
  );
}
