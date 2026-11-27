/**
 * @file The notes offered when asking the AI, in Settings → AI: for each kind of ask, the
 * notes shown as ticks beside its *Ask AI* button, which an admin adds, rewords, and removes.
 *
 * A change saves at once: a note typed when Enter is pressed or the field is left, a note
 * removed when its button is pressed. An emptied note is removed.
 */

import { PlusIcon, XIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { Trans } from "react-i18next";

import { type AiAsk, type AiNote, MAX_AI_NOTE, type Settings } from "../api";
import { composing } from "../ime";
import {
  CHANGED_ELSEWHERE,
  type SettingsNotice,
  saveChange,
  settingsFailure,
  settingsNotice,
} from "../library/householdSettings";
import { useWords } from "../locale";

const HELP =
  "Offered beside each <ask>Ask AI</ask> button, under ▾ or a right-click, to tick and send with the question.";

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
  const t = useWords();
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState<AiAsk | undefined>(undefined);
  const [note, setNote] = useState("");
  const [error, setError] = useState<SettingsNotice>(null);
  if (settings === undefined) {
    return null;
  }
  const notes = settings.ai_notes;

  const save = async (next: readonly AiNote[]) => {
    setSaving(true);
    setNote("");
    setError(null);
    try {
      const { outcome, settings: now } = await saveChange(settings, { ai_notes: next });
      onSettings(now);
      setNote(outcome === "conflict" ? CHANGED_ELSEWHERE : "Saved.");
    } catch (failure) {
      setError(settingsFailure(failure));
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
        <Trans t={t} i18nKey={HELP} defaults={HELP} components={{ ask: <strong /> }} />
      </p>
      {ASKS.map(({ ask, legend }) => (
        <fieldset key={ask} className="ai-notes-group" disabled={saving}>
          <legend>{t(legend)}</legend>
          {notes.map((each, index) =>
            each.ask === ask ? (
              <div key={`${String(index)} ${each.text}`} className="ai-notes-row">
                <input
                  className="detail-input"
                  aria-label={t("Note: {{note}}", { note: each.text })}
                  defaultValue={each.text}
                  maxLength={MAX_AI_NOTE}
                  onBlur={(event) => {
                    reword(index, event.currentTarget.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !composing(event.nativeEvent)) {
                      event.preventDefault();
                      reword(index, event.currentTarget.value);
                    }
                  }}
                />
                <button
                  type="button"
                  className="icon"
                  aria-label={t("Remove the note “{{note}}”", { note: each.text })}
                  title={t("Remove this note")}
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
              aria-label={t("New note")}
              maxLength={MAX_AI_NOTE}
              placeholder={t("Tell the AI what to look for")}
              // The field opens on pressing Add a note, to type the note at once.
              autoFocus
              onBlur={(event) => {
                add(ask, event.currentTarget.value);
              }}
              onKeyDown={(event) => {
                if (composing(event.nativeEvent)) return;
                if (event.key === "Enter") {
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
              <PlusIcon aria-hidden /> {t("Add a note")}
            </button>
          )}
        </fieldset>
      ))}
      {error !== null && <p role="alert">{settingsNotice(error, t)}</p>}
      <p className="hint saved" role="status">
        {note === "" ? "" : t(note)}
      </p>
    </div>
  );
}
