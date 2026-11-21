/**
 * Which Tracks an enricher may be asked about at a time. The server says when each Track
 * asked before may be asked again, so its answer holds no time and can be kept; the page
 * applies the wait against its own clock.
 */
import type { Enricher } from "../api";

/** Which Tracks an enricher may be asked about at a time, and when that next changes. */
export interface Asking {
  /** The Tracks it may be asked about. */
  readonly findable: ReadonlySet<number>;
  /** The Tracks still waiting that someone may choose to ask again: the AI's only. */
  readonly askedRecently: ReadonlySet<number>;
  /** When the next wait passes, in ms since the epoch; `undefined` when none is under way. */
  readonly changesAt: number | undefined;
}

/** Return which Tracks `enricher` may be asked about at `now`, in ms since the epoch. */
export function askingAt(enricher: Enricher, now: number): Asking {
  const findable = new Set<number>();
  const askedRecently = new Set<number>();
  let changesAt: number | undefined;
  for (const id of enricher.eligible) {
    const until = enricher.waiting[String(id)];
    const at = until === undefined ? undefined : Date.parse(until);
    if (at === undefined || at <= now) {
      findable.add(id);
      continue;
    }
    if (enricher.asks_again) {
      askedRecently.add(id);
    }
    changesAt = changesAt === undefined ? at : Math.min(changesAt, at);
  }
  return { findable, askedRecently, changesAt };
}
