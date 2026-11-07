/**
 * @file A sleep timer: pause what plays once a chosen time is up.
 *
 * It lives in this page alone, so closing or reloading the page turns it off. A
 * browser may run a hidden page's timers late, by up to a minute.
 */

import { useEffect, useEffectEvent, useState } from "react";

/** The times a sleep timer offers, in minutes. */
export const SLEEP_MINUTES = [15, 30, 45, 60, 120] as const;

const MINUTE_MS = 60_000;

/** A sleep timer, and the ways to set it. */
export interface SleepTimer {
  /** When it pauses, in milliseconds since the epoch, or `null` while off. */
  readonly endsAt: number | null;
  /** When it was set, in milliseconds since the epoch, or `null` while off. */
  readonly setAt: number | null;
  /** Pause `minutes` from now, replacing any time set before. */
  readonly start: (minutes: number) => void;
  readonly stop: () => void;
}

/** Call `pause` once the time chosen is up; it pauses whatever plays then, if anything does. */
export function useSleepTimer(pause: () => void): SleepTimer {
  const [set, setSet] = useState<{ readonly at: number; readonly ends: number } | null>(null);
  const endsAt = set?.ends ?? null;
  const pauseNow = useEffectEvent(pause);

  useEffect(() => {
    if (endsAt === null) {
      return undefined;
    }
    const timer = setTimeout(
      () => {
        pauseNow();
        setSet(null);
      },
      Math.max(0, endsAt - Date.now()),
    );
    return () => {
      clearTimeout(timer);
    };
  }, [endsAt]);

  return {
    endsAt,
    setAt: set?.at ?? null,
    start: (minutes) => {
      const at = Date.now();
      setSet({ at, ends: at + minutes * MINUTE_MS });
    },
    stop: () => {
      setSet(null);
    },
  };
}
