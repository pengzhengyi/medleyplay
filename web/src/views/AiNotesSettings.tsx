/**
 * @file The notes offered when asking the AI, in Settings → AI: for each kind of ask, the
 * notes shown as ticks beside its *Ask AI* button, which an admin adds, rewords, and removes.
 *
 * A change saves at once: a note typed when Enter is pressed or the field is left, a note
 * removed when its button is pressed. An emptied note is removed.
 */

import { PlusIcon, XIcon } from "@phosphor-icons/react";
import { useState } from "react";

import { type AiAsk, type AiNote, MAX_AI_NOTE, type Settings } from "../api";
import { CHANGED_ELSEWHERE, notSaved, saveChange } from "../library/householdSettings";

/** Each kind of ask, as its group of notes is named. */
const ASKS: readonly { readonly ask: AiAsk; readonly legend: string }[] = [
  { ask: "details", legend: "Notes when asking for details" },
  { ask: "songs", legend: "Notes when asking for songs" },
];

/** The household's notes for the AI, to edit; for an admin, as the AI section is. */
export function AiNotesSettings({
  settings,
  onSettings,
}: {
  /** The household's settings as last read, shared with the other sections that save them. */
  readonly settings: Settings | undefined;
  readonly onSettings: (settings: Settings) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState<AiAsk | undefined>(undefined);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  if (settings === undefined) {
    return null;
  }
  const notes = settings.ai_notes;

  const save = async (next: readonly AiNote[]) => {
    setSaving(true);
    setNote("");
    setError("");
    try {
      const { outcome, settings: now } = await saveChange(settings, { ai_notes: next });
      onSettings(now);
      setNote(outcome === "conflict" ? CHANGED_ELSEWHERE : "Saved.");
    } catch (failure) {
      setError(notSaved(failure));
    } finally {
      setSaving(false);
    }
  };
  /** Save the note at `index` of every note as `text`; an emptied one is removed. */
  const reword = (index: number, text: string) => {
    const kept = text.trim();
    const before = notes[index];
    if (before === undefined || kept === before.text) {
      return;
    }
    void save(
      kept === ""
        ? notes.filter((_, at) => at !== index)
        : notes.map((each, at) => (at === index ? { ...each, text: kept } : each)),
    );
  };
  const add = (ask: AiAsk, text: string) => {
    setAdding(undefined);
    const kept = text.trim();
    if (kept !== "") {
      void save([...notes, { ask, text: kept }]);
    }
  };

  return (
    <div className="ai-notes" aria-busy={saving}>
      <p className="hint">
        Offered beside each <strong>Ask AI</strong> button, under ▾ or a right-click, to tick and
        send with the question.
      </p>
      {ASKS.map(({ ask, legend }) => (
        <fieldset key={ask} className="ai-notes-group" disabled={saving}>
          <legend>{legend}</legend>
          {notes.map((each, index) =>
            each.ask === ask ? (
              <div key={`${String(index)} ${each.text}`} className="ai-notes-row">
                <input
                  className="detail-input"
                  aria-label={`Note: ${each.text}`}
                  defaultValue={each.text}
                  maxLength={MAX_AI_NOTE}
                  onBlur={(event) => {
                    reword(index, event.currentTarget.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      reword(index, event.currentTarget.value);
                    }
                  }}
                />
                <button
                  type="button"
                  className="icon"
                  aria-label={`Remove the note “${each.text}”`}
                  title="Remove this note"
                  onClick={() => void save(notes.filter((_, at) => at !== index))}
                >
                  <XIcon aria-hidden />
                </button>
              </div>
            ) : null,
          )}
          {adding === ask ? (
            <input
              className="detail-input"
              aria-label="New note"
              maxLength={MAX_AI_NOTE}
              placeholder="Tell the AI what to look for"
              // The field opens on pressing Add a note, to type the note at once.
              autoFocus
              onBlur={(event) => {
                add(ask, event.currentTarget.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  add(ask, event.currentTarget.value);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setAdding(undefined);
                }
              }}
            />
          ) : (
            <button
              type="button"
              className="link-button ai-notes-add"
              onClick={() => {
                setAdding(ask);
              }}
            >
              <PlusIcon aria-hidden /> Add a note
            </button>
          )}
        </fieldset>
      ))}
      {error !== "" && <p role="alert">{error}</p>}
      <p className="hint saved" role="status">
        {note}
      </p>
    </div>
  );
}
