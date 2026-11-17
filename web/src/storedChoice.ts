/**
 * @file A yes-or-no choice this browser keeps, such as how the rail shows.
 *
 * Each browser keeps its own; without storage a choice lasts as long as the page.
 */

import { useSyncExternalStore } from "react";

/** A yes-or-no choice kept under `key`, saved as `value` while on. */
export function choice(key: string, value: string) {
  const listeners = new Set<() => void>();
  let fallback = false;
  const read = (): boolean => {
    try {
      return localStorage.getItem(key) === value;
    } catch {
      return fallback;
    }
  };
  const set = (on: boolean): void => {
    fallback = on;
    try {
      if (on) {
        localStorage.setItem(key, value);
      } else {
        localStorage.removeItem(key);
      }
    } catch {
      // Without storage the choice lasts as long as the page.
    }
    for (const listener of listeners) {
      listener();
    }
  };
  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const use = (): boolean => useSyncExternalStore(subscribe, read, () => false);
  return [set, use] as const;
}
