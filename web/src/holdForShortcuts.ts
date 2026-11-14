/**
 * @file Whether holding ⌘ (Ctrl off Apple devices) shows the shortcuts, as this browser chose.
 *
 * It is on unless turned off in Settings. The choice belongs to the keyboard in
 * front of you, so each browser keeps its own; without storage it stays on.
 */

import { useSyncExternalStore } from "react";

const KEY = "medleyplay.holdForShortcuts";
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

/** Turn showing the shortcuts while the key is held on or off in this browser. */
export function setHoldForShortcuts(on: boolean): void {
  try {
    if (on) {
      localStorage.removeItem(KEY);
    } else {
      localStorage.setItem(KEY, "off");
    }
  } catch {
    // Without storage the choice lasts as long as the page.
  }
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether holding the key shows the shortcuts in this browser. */
export function useHoldForShortcuts(): boolean {
  return useSyncExternalStore(subscribe, read, () => true);
}
