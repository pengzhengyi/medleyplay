/**
 * @file Lyrics being synced to a song: their lines, each with the time it is sung once
 * stamped, read from LRC or plain text and written back as LRC.
 *
 * ```text
 * [ti:Melt]                 a tag about the song: left out
 * [00:12.34]朝目が覚めて      a line stamped at 12.34 seconds
 * 真っ先に思い浮かぶ           a line not stamped yet
 * ```
 */

/** A line of lyrics being synced: the time it is sung, in milliseconds, once stamped. */
export interface SyncLine {
  readonly at_ms: number | null;
  readonly text: string;
}

const TIME = /^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/u;
const TAG = /^\[[a-z]+:.*\]$/iu;

/** Return the lines of `text` to sync, each with the first time it is stamped at; tags and blank lines left out. */
export function linesOf(text: string): SyncLine[] {
  const lines: SyncLine[] = [];
  for (const row of text.split(/\r\n|\r|\n/u)) {
    let rest = row.trim();
    if (rest === "" || (TAG.test(rest) && !TIME.test(rest))) {
      continue;
    }
    let at_ms: number | null = null;
    for (let found = TIME.exec(rest); found !== null; found = TIME.exec(rest)) {
      at_ms ??= msOf(found);
      rest = rest.slice(found[0].length);
    }
    lines.push({ at_ms, text: rest.trim() });
  }
  return lines;
}

function msOf(found: RegExpExecArray): number {
  const [, minutes = "0", seconds = "0", fraction = "0"] = found;
  return (
    (Number(minutes) * 60 + Number(seconds)) * 1000 + Number(fraction.padEnd(3, "0").slice(0, 3))
  );
}

/** Return `ms` as an LRC time: `[01:02.35]`, to the hundredth of a second. */
export function lrcTime(ms: number): string {
  const hundredths = Math.round(ms / 10);
  const minutes = Math.floor(hundredths / 6000);
  const seconds = (hundredths % 6000) / 100;
  return `[${String(minutes).padStart(2, "0")}:${seconds.toFixed(2).padStart(5, "0")}]`;
}

/** Return `lines` as LRC, each stamped line with its time and any other as written. */
export function lrcOf(lines: readonly SyncLine[]): string {
  return (
    lines
      .map((line) => (line.at_ms === null ? line.text : `${lrcTime(line.at_ms)}${line.text}`))
      .join("\n") + "\n"
  );
}

/** Return `lines` with the line at `index` stamped at `ms`. */
export function stamped(lines: readonly SyncLine[], index: number, ms: number): SyncLine[] {
  return lines.map((line, at) =>
    at === index ? { ...line, at_ms: Math.max(0, Math.round(ms)) } : line,
  );
}

/** Return `lines` with the line at `index`, if stamped, `ms` later; earlier for a negative `ms`, never before 0. */
export function nudged(lines: readonly SyncLine[], index: number, ms: number): SyncLine[] {
  return lines.map((line, at) =>
    at === index && line.at_ms !== null ? { ...line, at_ms: Math.max(0, line.at_ms + ms) } : line,
  );
}

/** Return `lines` with every stamped line `ms` later; earlier for a negative `ms`, never before 0. */
export function shifted(lines: readonly SyncLine[], ms: number): SyncLine[] {
  return lines.map((line) =>
    line.at_ms === null ? line : { ...line, at_ms: Math.max(0, line.at_ms + ms) },
  );
}
