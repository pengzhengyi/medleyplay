/**
 * @file Changing the keyboard shortcuts: each command's keys, added from the next press or removed.
 *
 * Choosing Add keys waits for keys on that button: the next press, with any
 * modifiers held, joins the command's keys, unless another command has them.
 * Escape, or moving away, adds nothing. The keys are the Account's, so they
 * follow it to any browser. Whether holding ⌘ shows them is each browser's own.
 */

import { XIcon } from "@phosphor-icons/react";
import { type KeyboardEvent, useRef, useState } from "react";

import {
  type Bindings,
  COMMANDS,
  type Command,
  DEFAULT_BINDINGS,
  MAX_KEYS,
  addKeys,
  belongsToBrowser,
  bindingOf,
  changesOf,
  labelOf,
  removeKeys,
  saveBindings,
  useBindings,
} from "../shortcuts";
import { setHoldForShortcuts, useHoldForShortcuts } from "../holdForShortcuts";
import { type Words, useWords } from "../locale";
import { HOLD_LABEL } from "../useHeldModifier";
import { classOf, useNoteOf } from "../useNote";

const nameOf = (command: Command) => COMMANDS.find((each) => each.command === command)?.name;

type ShortcutNotice =
  | { readonly kind: "save-failed"; readonly reason: string }
  | { readonly kind: "browser"; readonly binding: string }
  | {
      readonly kind: "conflict" | "added" | "removed";
      readonly command: Command;
      readonly binding: string;
    }
  | { readonly kind: "full"; readonly command: Command }
  | { readonly kind: "reset" };

function wordsOf(notice: ShortcutNotice, t: Words): string {
  switch (notice.kind) {
    case "save-failed":
      return t("Changed on this device but not saved to your account: {{reason}}", {
        reason: notice.reason,
      });
    case "browser":
      return t("The browser keeps {{keys}}. Press other keys.", {
        keys: labelOf(notice.binding, t),
      });
    case "conflict":
      return t("{{keys}} is already {{command}}. Press other keys.", {
        command: t(nameOf(notice.command) ?? ""),
        keys: labelOf(notice.binding, t),
      });
    case "full":
      return t("{{command}} has {{count}} keys; remove one first.", {
        command: t(nameOf(notice.command) ?? ""),
        count: MAX_KEYS,
      });
    case "added":
      return t("{{command}} now also has {{keys}}.", {
        command: t(nameOf(notice.command) ?? ""),
        keys: labelOf(notice.binding, t),
      });
    case "removed":
      return t("{{command}} no longer has {{keys}}.", {
        command: t(nameOf(notice.command) ?? ""),
        keys: labelOf(notice.binding, t),
      });
    case "reset":
      return t("Back to the usual keys.");
  }
}

/** What the Settings section for the keyboard shortcuts holds. */
export function ShortcutSettings() {
  const t = useWords();
  const bindings = useBindings();
  const holding = useHoldForShortcuts();
  const [recording, setRecording] = useState<Command | undefined>(undefined);
  const notes = useNoteOf<ShortcutNotice | null>(null);
  // Some browsers click a button as Space comes up, so the release of a press taken is kept too.
  const taken = useRef<string | undefined>(undefined);
  const lastSave = useRef(0);
  const defaults = changesOf(bindings) === null;

  /** Use `next` from now on, saying `said`, or why the server didn't keep it. */
  const save = (next: Bindings, said: ShortcutNotice) => {
    const request = ++lastSave.current;
    notes.confirm(said);
    saveBindings(next).catch((failure: unknown) => {
      if (request !== lastSave.current) return;
      const reason = failure instanceof Error ? failure.message : String(failure);
      notes.refuse({ kind: "save-failed", reason });
    });
  };

  const record = (command: Command, event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setRecording(undefined);
      notes.tell(null);
      return;
    }
    const keys = bindingOf(event.nativeEvent);
    if (keys === undefined) {
      // A modifier on its own waits for its key; Tab moves on, as it always does.
      return;
    }
    // The press is the new keys, not a press of the button or a shortcut.
    event.preventDefault();
    event.stopPropagation();
    taken.current = event.code;
    if (belongsToBrowser(keys)) {
      notes.refuse({ kind: "browser", binding: keys });
      return;
    }
    const added = addKeys(bindings, command, keys);
    if ("taken" in added) {
      notes.refuse({ kind: "conflict", command: added.taken, binding: keys });
      return;
    }
    setRecording(undefined);
    if ("full" in added) {
      notes.refuse({ kind: "full", command });
      return;
    }
    if (added.bindings === bindings) {
      notes.tell(null);
      return;
    }
    save(added.bindings, { kind: "added", command, binding: keys });
  };

  return (
    <>
      <p className="hint">{t("Keys for the player, kept with your account.")}</p>
      <label className="hold-setting">
        <input
          type="checkbox"
          checked={holding}
          onChange={(event) => {
            setHoldForShortcuts(event.currentTarget.checked);
          }}
        />
        {t("Show them while {{key}} is held, in this browser", { key: HOLD_LABEL })}
      </label>
      <ul className="shortcut-settings">
        {COMMANDS.map(({ command, name }) => {
          const label = t(name);
          const waiting = recording === command;
          return (
            <li key={command} className="shortcut-row">
              <span className="shortcut-name">{label}</span>
              <span className="shortcut-keys">
                {bindings[command].length === 0 && <span className="no-keys">{t("None")}</span>}
                {bindings[command].map((keys) => (
                  <span key={keys} className="key-chip">
                    <kbd>{labelOf(keys)}</kbd>
                    <button
                      type="button"
                      className="icon remove-keys"
                      aria-label={t("Remove {{keys}} from {{command}}", {
                        keys: labelOf(keys, t),
                        command: label,
                      })}
                      title={t("Remove {{keys}}", { keys: labelOf(keys, t) })}
                      onClick={() => {
                        save(removeKeys(bindings, command, keys), {
                          kind: "removed",
                          command,
                          binding: keys,
                        });
                      }}
                    >
                      <XIcon weight="bold" aria-hidden />
                    </button>
                  </span>
                ))}
              </span>
              <button
                type="button"
                className={waiting ? "outline change-keys waiting" : "outline change-keys"}
                aria-label={t(
                  waiting ? "Press keys to add to {{command}}" : "Add keys to {{command}}",
                  { command: label },
                )}
                onClick={() => {
                  setRecording(command);
                  notes.tell(null);
                }}
                onKeyDown={(event) => {
                  if (waiting) {
                    record(command, event);
                  }
                }}
                onKeyUp={(event) => {
                  if (event.code === taken.current) {
                    taken.current = undefined;
                    event.preventDefault();
                  }
                }}
                onBlur={() => {
                  if (waiting) {
                    setRecording(undefined);
                  }
                }}
              >
                {t(waiting ? "Press keys…" : "Add keys")}
              </button>
            </li>
          );
        })}
      </ul>
      <p className={classOf(notes.note, "hint saved")} role="status">
        {notes.note.text === null ? "" : wordsOf(notes.note.text, t)}
      </p>
      <button
        type="button"
        className="secondary outline"
        disabled={defaults}
        onClick={() => {
          setRecording(undefined);
          save(DEFAULT_BINDINGS, { kind: "reset" });
        }}
      >
        {t("Reset to defaults")}
      </button>
    </>
  );
}
