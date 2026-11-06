/**
 * @file The time now, for what the page writes about the clock.
 *
 * It's read again every 15 seconds while a component shows it, which is close
 * enough for a time written to the minute.
 */

import { useSyncExternalStore } from "react";

const EVERY_MS = 15_000;

let now = Date.now();

function subscribe(onChange: () => void) {
  const read = () => {
    now = Date.now();
    onChange();
  };
  // The time last read may be from long ago, when nothing showed it.
  read();
  const timer = setInterval(read, EVERY_MS);
  return () => {
    clearInterval(timer);
  };
}

/** The time now, in milliseconds since the epoch, read again every 15 seconds. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, () => now);
}
