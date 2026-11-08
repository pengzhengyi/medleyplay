/**
 * @file How often the Account played each Track over a period, for Insights.
 *
 * All time is each Track's own play count, which the page already holds. A
 * shorter period asks the server, again when the page sends a play or is shown again.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { type PlayCountPeriod, type Track, api } from "../api";
import { onPlaysRecorded } from "../player/usePlayer";
import { type PlayCounts, allTimePlays } from "./insights";

/** All time, or the last 7 or 30 days. */
export type Period = "all" | PlayCountPeriod;

export interface PeriodPlays {
  /** How often each Track was played; `undefined` until the counts load. */
  readonly counts: PlayCounts | undefined;
  /** Why the counts couldn't load, or `""`. */
  readonly failure: string;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** How often each of `tracks` was played over `period`. */
export function usePlayCounts(period: Period, tracks: readonly Track[]): PeriodPlays {
  const allTime = useMemo(() => allTimePlays(tracks), [tracks]);
  const [loaded, setLoaded] = useState<{ period: Period; counts: PlayCounts } | undefined>();
  const [failure, setFailure] = useState("");
  // The latest load asked, so an older answer can't land after it.
  const asked = useRef(0);

  useEffect(() => {
    if (period === "all") {
      return undefined;
    }
    const load = () => {
      const ask = ++asked.current;
      api.playCounts(period).then(
        (answer) => {
          if (ask === asked.current) {
            setFailure("");
            setLoaded({ period, counts: new Map(answer.map((row) => [row.track_id, row.plays])) });
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

  if (period === "all") {
    return { counts: allTime, failure: "" };
  }
  return { counts: loaded?.period === period ? loaded.counts : undefined, failure };
}
