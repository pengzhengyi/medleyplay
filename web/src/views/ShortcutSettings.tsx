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
import { HOLD_LABEL } from "../useHeldModifier";
import { classOf, useNote } from "../useNote";

const nameOf = (command: Command) => COMMANDS.find((each) => each.command === command)?.name;

/** What the Settings section for the keyboard shortcuts holds. */
export function ShortcutSettings() {
  const bindings = useBindings();
  const holding = useHoldForShortcuts();
  const [recording, setRecording] = useState<Command | undefined>(undefined);
  const notes = useNote();
  // Some browsers click a button as Space comes up, so the release of a press taken is kept too.
  const taken = useRef<string | undefined>(undefined);
  const defaults = changesOf(bindings) === null;

  /** Use `next` from now on, saying `said`, or why the server didn't keep it. */
  const save = (next: Bindings, said: string) => {
    notes.confirm(said);
    saveBindings(next).catch((failure: unknown) => {
      const reason = failure instanceof Error ? failure.message : String(failure);
      notes.refuse(`The server didn't keep them: ${reason}. This browser has them until it does.`);
    });
  };

  const record = (command: Command, event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setRecording(undefined);
      notes.tell("");
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
      notes.refuse(`The browser keeps ${labelOf(keys)}. Press other keys.`);
      return;
    }
    const added = addKeys(bindings, command, keys);
    if ("taken" in added) {
      notes.refuse(`${labelOf(keys)} is already ${nameOf(added.taken) ?? ""}. Press other keys.`);
      return;
    }
    setRecording(undefined);
    if ("full" in added) {
      notes.refuse(`${nameOf(command) ?? ""} has ${String(MAX_KEYS)} keys; remove one first.`);
      return;
    }
    save(added.bindings, `${nameOf(command) ?? ""} now also has ${labelOf(keys)}.`);
  };

  return (
    <>
      <p className="hint">Keys for the player, kept with your account.</p>
      <label className="hold-setting">
        <input
          type="checkbox"
          checked={holding}
          onChange={(event) => {
            setHoldForShortcuts(event.currentTarget.checked);
          }}
        />
        Show them while {HOLD_LABEL} is held, in this browser
      </label>
      <ul className="shortcut-settings">
        {COMMANDS.map(({ command, name }) => {
          const waiting = recording === command;
          return (
            <li key={command} className="shortcut-row">
              <span className="shortcut-name">{name}</span>
              <span className="shortcut-keys">
                {bindings[command].length === 0 && <span className="no-keys">None</span>}
                {bindings[command].map((keys) => (
                  <span key={keys} className="key-chip">
                    <kbd>{labelOf(keys)}</kbd>
                    <button
                      type="button"
                      className="icon remove-keys"
                      aria-label={`Remove ${labelOf(keys)} from ${name}`}
                      title={`Remove ${labelOf(keys)}`}
                      onClick={() => {
                        save(
                          removeKeys(bindings, command, keys),
                          `${name} no longer has ${labelOf(keys)}.`,
                        );
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
                aria-label={waiting ? `Press keys to add to ${name}` : `Add keys to ${name}`}
                onClick={() => {
                  setRecording(command);
                  notes.tell("");
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
                {waiting ? "Press keys…" : "Add keys"}
              </button>
            </li>
          );
        })}
      </ul>
      <p className={classOf(notes.note, "hint saved")} role="status">
        {notes.note.text}
      </p>
      <button
        type="button"
        className="secondary outline"
        disabled={defaults}
        onClick={() => {
          setRecording(undefined);
          save(DEFAULT_BINDINGS, "Back to the usual keys.");
        }}
      >
        Reset to defaults
      </button>
    </>
  );
}
