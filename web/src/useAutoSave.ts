/**
 * @file Save a setting as it changes, with no Save button: at once for a choice, once
 * typing pauses for a typed value.
 *
 * One save runs at a time. A value changed while one is saving waits for it, and only the
 * latest such value is saved next, so each save starts from what the one before it left.
 * A typed value still waiting is saved when its field loses focus, on Enter, when the
 * section goes away, and when the page is hidden or closed. The note beside the section
 * says *Saving…*, then *Saved.*, which fades.
 *
 * A value that couldn't be saved, as when the server can't be reached, waits to be tried
 * again: on the next change, when the device is back online, or when the page is shown again.
 */

import { useEffect, useRef } from "react";

import { type Notes, useNote } from "./useNote";

/** How long typing must pause before a typed value is saved. */
export const AUTO_SAVE_MS = 800;

/**
 * How a save went: `saved`; `unchanged`, as the value was already saved; `held`, waiting
 * for the person to confirm it; `conflict`, someone else changed it first; or `failed`,
 * to be tried again. Each but `saved` leaves the note to the save.
 */
export type Outcome = "saved" | "unchanged" | "held" | "conflict" | "failed";

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
  /** Whether a value waits to be saved or is saving now. */
  readonly busy: () => boolean;
}

/** Save each value through `save`, which says how it went and writes any note but *Saved.* */
export function useAutoSave<T>(save: (value: T, notes: Notes) => Promise<Outcome>): AutoSave<T> {
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
    const settle = (outcome: Outcome) => {
      running.current = false;
      if (outcome === "conflict") {
        waiting.current = undefined;
      } else if (outcome === "failed") {
        // A newer value waiting replaces the one that failed; either is tried again later.
        waiting.current ??= next;
        return;
      }
      if (waiting.current !== undefined) {
        run();
      } else if (outcome === "saved") {
        notes.confirm("Saved.");
      }
    };
    saving.current(next.value, notes).then(settle, (failure: unknown) => {
      notes.refuse(`Not saved: ${failure instanceof Error ? failure.message : String(failure)}`);
      settle("failed");
    });
  };
  const latestRun = useRef(run);
  useEffect(() => {
    latestRun.current = run;
  });
  useEffect(() => {
    const again = () => {
      latestRun.current();
    };
    const onVisibility = () => {
      again();
    };
    window.addEventListener("online", again);
    window.addEventListener("pagehide", again);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("online", again);
      window.removeEventListener("pagehide", again);
      document.removeEventListener("visibilitychange", onVisibility);
      again();
    };
  }, []);

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
    busy: () => waiting.current !== undefined || running.current,
  };
}
