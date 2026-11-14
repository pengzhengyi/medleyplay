/**
 * @file Snapping song starts to the gaps in a file's audio.
 *
 * A start guessed from a video's text or an AI model is often a few seconds off. Each
 * start but the first moves to the end of the gap nearest it, within half a minute
 * either way, keeping the songs in order; a start with no gap that near stays. Gaps
 * closer than a second are one gap, as a fade can break one silence into two.
 */

import type { Silence } from "../api";

/** How far a start may move to a gap, either way. */
export const SNAP_WINDOW_MS = 30_000;
/** Silences closer than this are one gap. */
const JOINED_MS = 1_000;

/** Return each start moved to the gap nearest it; a start of no time, or with no gap near, stays. */
export function snapStarts(
  starts: readonly (number | undefined)[],
  silences: readonly Silence[],
  windowMs = SNAP_WINDOW_MS,
): (number | undefined)[] {
  const ends = gapsOf(silences)
    .filter((gap) => gap.start_ms > 0)
    .map((gap) => gap.end_ms);
  const used = new Set<number>();
  const snapped: (number | undefined)[] = [];
  for (const [index, start] of starts.entries()) {
    const before = snapped.at(-1) ?? -1;
    const after = starts.slice(index + 1).find((each) => each !== undefined) ?? Infinity;
    if (index === 0 || start === undefined) {
      snapped.push(start);
      continue;
    }
    let nearest: number | undefined;
    for (const end of ends) {
      const near = Math.abs(end - start) <= windowMs && end > before && end < after;
      if (
        near &&
        !used.has(end) &&
        (nearest === undefined || Math.abs(end - start) < Math.abs(nearest - start))
      ) {
        nearest = end;
      }
    }
    if (nearest !== undefined) {
      used.add(nearest);
    }
    snapped.push(nearest ?? start);
  }
  return snapped;
}

/** Return the gaps: the silences in order, those closer than a second joined into one. */
function gapsOf(silences: readonly Silence[]): Silence[] {
  const gaps: Silence[] = [];
  for (const silence of [...silences].sort((a, b) => a.start_ms - b.start_ms)) {
    const last = gaps.at(-1);
    if (last !== undefined && silence.start_ms - last.end_ms < JOINED_MS) {
      gaps[gaps.length - 1] = {
        start_ms: last.start_ms,
        end_ms: Math.max(last.end_ms, silence.end_ms),
      };
    } else {
      gaps.push(silence);
    }
  }
  return gaps;
}
