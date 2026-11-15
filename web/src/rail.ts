/**
 * @file Whether the rail of views shows only its icons, as this browser chose.
 *
 * The choice belongs to the screen in front of you, so each browser keeps its own;
 * without storage it lasts as long as the page.
 */

import { useSyncExternalStore } from "react";

const KEY = "medleyplay.rail";
const listeners = new Set<() => void>();
let fallback = false;

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "icons";
  } catch {
    return fallback;
  }
}

/** Show only the rail's icons, or its names too, in this browser. */
export function setRailCollapsed(collapsed: boolean): void {
  fallback = collapsed;
  try {
    if (collapsed) {
      localStorage.setItem(KEY, "icons");
    } else {
      localStorage.removeItem(KEY);
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

/** Whether the rail shows only its icons in this browser. */
export function useRailCollapsed(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}
