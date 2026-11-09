/**
 * @file How often and how long the Account played each Track over a period, for Insights.
 *
 * It asks the server, and again when the page records a play or is shown again.
 */

import { useEffect, useRef, useState } from "react";

import { type PlayCountPeriod, api } from "../api";
import { onPlaysRecorded } from "../player/plays";
import type { PlayCounts } from "./insights";

/** All time, or the last 7 or 30 days. */
export type Period = "all" | PlayCountPeriod;

export interface PeriodPlays {
  /** How often and how long each Track was played; `undefined` until the counts load. */
  readonly counts: PlayCounts | undefined;
  /** Why the counts couldn't load, or `""`. */
  readonly failure: string;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** How often and how long the Account played each Track over `period`. */
export function usePlayCounts(period: Period): PeriodPlays {
  const [loaded, setLoaded] = useState<{ period: Period; counts: PlayCounts } | undefined>();
  const [failure, setFailure] = useState("");
  // The latest load asked, so an older answer can't land after it.
  const asked = useRef(0);

  useEffect(() => {
    const load = () => {
      const ask = ++asked.current;
      api.playCounts(period === "all" ? undefined : period).then(
        (answer) => {
          if (ask === asked.current) {
            setFailure("");
            const counts = new Map(
              answer.map((row) => [
                row.track_id,
                { plays: row.plays, listenedMs: row.listened_ms, timedPlays: row.timed_plays },
              ]),
            );
            setLoaded({ period, counts });
          }
        },
        (error: unknown) => {
          if (ask === asked.current) {
            setFailure(messageOf(error));
          }
        },
      );
    };
    const whenVisible = () => {
      if (document.visibilityState === "visible") {
        load();
      }
    };
    load();
    const stop = onPlaysRecorded(load);
    document.addEventListener("visibilitychange", whenVisible);
    return () => {
      asked.current += 1;
      stop();
      document.removeEventListener("visibilitychange", whenVisible);
    };
  }, [period]);

  return { counts: loaded?.period === period ? loaded.counts : undefined, failure };
}
