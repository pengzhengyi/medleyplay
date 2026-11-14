/**
 * @file The time now, for what the page writes about the clock.
 *
 * It's read again every 15 seconds while a component shows it, which is close
 * enough for a time written to the minute.
 */

import { useSyncExternalStore } from "react";

const EVERY_MS = 15_000;

let now = Date.now();
let showing = 0;

function subscribe(onChange: () => void) {
  const read = () => {
    now = Date.now();
    onChange();
  };
  showing += 1;
  read();
  const timer = setInterval(read, EVERY_MS);
  return () => {
    showing -= 1;
    clearInterval(timer);
  };
}

/** The time last read, read afresh first if nothing showed it and it is out of date. */
function snapshot(): number {
  // The time last read may be from long ago, when nothing showed it; a first render
  // reads it again rather than writing the old time for a moment.
  if (showing === 0 && Math.abs(Date.now() - now) >= EVERY_MS) {
    now = Date.now();
  }
  return now;
}

/** The time now, in milliseconds since the epoch, read again every 15 seconds. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, snapshot);
}
