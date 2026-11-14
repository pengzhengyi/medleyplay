/**
 * @file Save a setting as it changes, with no Save button: at once for a choice, once
 * typing pauses for a typed value.
 *
 * One save runs at a time. A value changed while one is saving waits for it, and only the
 * latest such value is saved next, so each save starts from what the one before it left.
 * A typed value still waiting is saved when its field loses focus, on Enter, and when the
 * section goes away. The note beside the section says *Saving…*, then *Saved.*, which fades.
 */

import { useEffect, useRef } from "react";

import { type Notes, useNote } from "./useNote";

/** How long typing must pause before a typed value is saved. */
export const AUTO_SAVE_MS = 800;

/** A setting saved as it changes, and the note beside it. */
export interface AutoSave<T> extends Notes {
  /** Save `value` once typing pauses, replacing a value still waiting. */
  readonly later: (value: T) => void;
  /** Save `value` now, or as soon as the save running ends. */
  readonly now: (value: T) => void;
  /** Save the value waiting now, if there is one. */
  readonly flush: () => void;
  /** Drop the value waiting, if there is one. */
  readonly cancel: () => void;
}

/**
 * Save each value through `save`, which resolves to whether it saved. A save that
 * didn't, such as one refused by a conflict, says why in the note it is given.
 */
export function useAutoSave<T>(save: (value: T, notes: Notes) => Promise<boolean>): AutoSave<T> {
  const notes = useNote();
  const saving = useRef(save);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const waiting = useRef<{ readonly value: T }>(undefined);
  const running = useRef(false);
  useEffect(() => {
    saving.current = save;
  });

  const run = () => {
    clearTimeout(timer.current);
    const next = waiting.current;
    if (next === undefined || running.current) {
      return;
    }
    waiting.current = undefined;
    running.current = true;
    notes.tell("Saving…");
    saving.current(next.value, notes).then(
      (saved) => {
        running.current = false;
        if (waiting.current !== undefined) {
          run();
        } else if (saved) {
          notes.confirm("Saved.");
        }
      },
      () => {
        running.current = false;
      },
    );
  };
  const runOnLeaving = useRef(run);
  useEffect(() => {
    runOnLeaving.current = run;
  });
  useEffect(
    () => () => {
      runOnLeaving.current();
    },
    [],
  );

  return {
    ...notes,
    later: (value) => {
      waiting.current = { value };
      clearTimeout(timer.current);
      timer.current = setTimeout(run, AUTO_SAVE_MS);
    },
    now: (value) => {
      waiting.current = { value };
      run();
    },
    flush: run,
    cancel: () => {
      clearTimeout(timer.current);
      waiting.current = undefined;
    },
  };
}
