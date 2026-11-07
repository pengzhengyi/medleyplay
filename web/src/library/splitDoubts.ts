/**
 * @file What looks wrong with a split, by rules of thumb, so the editor can say so.
 *
 * A song is rarely longer than a quarter of an hour, and an album rarely holds so
 * few songs that each is twelve minutes long. Neither stops a save: a live set
 * or a symphony breaks both. The lists found for a file, by the video and by an
 * AI, are a second opinion of each other: when they count different numbers of
 * songs, one of them is likely wrong.
 */

import { endOf } from "./songList";

/** A song this long is likely two. */
export const LONG_SONG_MS = 15 * 60_000;
/** An album whose songs are this long on average likely misses one. */
export const LONG_AVERAGE_MS = 12 * 60_000;

/** What looks wrong with a split. */
export interface SplitDoubts {
  /** The places, from 0, of the songs so long they may be two. */
  readonly long: ReadonlySet<number>;
  /** Whether so few songs share the file that one may be missing. */
  readonly few: boolean;
}

/**
 * Return what looks wrong with songs starting at `starts` in a file `lengthMs` long;
 * a start not typed yet, or a file of unknown length, raises no doubt it can't measure.
 */
export function doubtsOf(
  starts: readonly (number | undefined)[],
  lengthMs: number | null,
): SplitDoubts {
  const long = new Set<number>();
  starts.forEach((start, index) => {
    const end = endOf(starts, index, lengthMs);
    if (start !== undefined && end !== undefined && end - start > LONG_SONG_MS) {
      long.add(index);
    }
  });
  const few = lengthMs !== null && starts.length > 0 && lengthMs / starts.length > LONG_AVERAGE_MS;
  return { long, few };
}

/** A list of songs found for the file, and who found it, such as *the video*. */
export interface FoundCount {
  readonly name: string;
  readonly count: number;
}

/** Say how the lists found count differently, as *The video lists 12 songs, the AI 4.*; or `null`. */
export function countsDisagree(found: readonly FoundCount[]): string | null {
  const [first, ...rest] = found;
  if (first === undefined || rest.every((each) => each.count === first.count)) {
    return null;
  }
  const lead = `${first.name.charAt(0).toUpperCase()}${first.name.slice(1)}`;
  const others = rest.map((each) => `${each.name} ${String(each.count)}`).join(", ");
  return `${lead} lists ${String(first.count)} songs, ${others}.`;
}
