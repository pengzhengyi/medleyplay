/**
 * @file The songs editor's rows as a list of text, and how a song in it is heard.
 *
 * A list filled in keeps each song it still names, so a song retimed, moved, or
 * renamed in place keeps its ratings and plays.
 */

import type { Song } from "../api";
import { fold } from "./views";

/** How much of each end a check plays. */
const CHECK_MS = 5000;

/** The rows as a pasted list writes them: one song a line, its start first. */
export function listTextOf(
  rows: readonly { readonly start: string; readonly title: string; readonly artist: string }[],
): string {
  return rows
    .map(({ start, title, artist }) =>
      artist.trim() === "" ? `${start} ${title}` : `${start} ${title} - ${artist}`,
    )
    .join("\n");
}

/**
 * The song each of `songs` keeps from `old`: the first not yet kept with the same
 * title, folded, or else one that starts at the same time; `null` for a new song.
 */
export function keptIds(
  old: readonly {
    readonly id: number | null;
    readonly title: string;
    readonly startMs: number | undefined;
  }[],
  songs: readonly Song[],
): (number | null)[] {
  const kept = new Set<number>();
  const take = (found: (typeof old)[number] | undefined) => {
    if (found?.id === undefined || found.id === null) {
      return null;
    }
    kept.add(found.id);
    return found.id;
  };
  const free = (row: (typeof old)[number]) => row.id !== null && !kept.has(row.id);
  // Titles first, so a song moved is kept before a new one takes its time.
  const byTitle = songs.map((song) =>
    take(old.find((row) => free(row) && fold(row.title.trim()) === fold(song.title.trim()))),
  );
  return byTitle.map(
    (id, index) =>
      id ?? take(old.find((row) => free(row) && row.startMs === songs[index]?.start_ms)),
  );
}

/** Where song `index` of `starts` ends: the next start, or the end of a file `lengthMs` long. */
export function endOf(
  starts: readonly (number | undefined)[],
  index: number,
  lengthMs: number | null,
): number | undefined {
  return index + 1 < starts.length ? starts[index + 1] : (lengthMs ?? undefined);
}

/** The parts of a song from `from` to `to` a check plays: each end, or a short song whole. */
export function checkParts(from: number, to: number): { from: number; to: number }[] {
  return to - from <= 2 * CHECK_MS
    ? [{ from, to }]
    : [
        { from, to: from + CHECK_MS },
        { from: to - CHECK_MS, to },
      ];
}
