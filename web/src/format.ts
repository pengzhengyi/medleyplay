/**
 * @file How the page writes times.
 */

/** Write `seconds` as minutes and seconds, such as `3:07`; an unknown length is `–:––`. */
export function formatTime(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return "–:––";
  }
  const whole = Math.floor(seconds);
  return `${String(Math.floor(whole / 60))}:${String(whole % 60).padStart(2, "0")}`;
}

/** Write how many songs there are and how long they play, such as `12 songs, 48 min`. */
export function formatLength(count: number, durationMs: number): string {
  const songs = count === 1 ? "1 song" : `${String(count)} songs`;
  const minutes = Math.round(durationMs / 60_000);
  if (minutes === 0) {
    return songs;
  }
  const hours = Math.floor(minutes / 60);
  const length =
    hours === 0 ? `${String(minutes)} min` : `${String(hours)} hr ${String(minutes % 60)} min`;
  return `${songs}, ${length}`;
}

/**
 * Write how many albums and songs the Library's items hold and how long they play,
 * such as `2 albums, 12 songs, 1 hr 40 min`; with no album, as `formatLength` does.
 */
export function formatLibraryLength(albums: number, songs: number, durationMs: number): string {
  const length = formatLength(songs, durationMs);
  if (albums === 0) {
    return length;
  }
  return `${albums === 1 ? "1 album" : `${String(albums)} albums`}, ${length}`;
}

const clock = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });
const dayAndClock = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
});
const WEEK_MS = 7 * 24 * 3_600_000;

/**
 * Write what is queued and, given `ending`, when it ends: the time on the clock,
 * with the day once that isn't today, such as `12 songs, 48 min, ending around
 * 4:30 PM` or `…, ending around Wed 2:12 AM`. A week or more away, it says no time.
 */
export function formatQueueLength(
  count: number,
  durationMs: number,
  ending?: { readonly now: Date; readonly at: Date },
): string {
  const length = formatLength(count, durationMs);
  if (ending === undefined || ending.at.getTime() - ending.now.getTime() >= WEEK_MS) {
    return length;
  }
  const { now, at } = ending;
  const today = at.toDateString() === now.toDateString();
  return `${length}, ending around ${(today ? clock : dayAndClock).format(at)}`;
}

const UNITS = ["bytes", "KB", "MB", "GB", "TB"] as const;

/** Write `bytes` in the decimal units Finder uses, such as `420 MB` or `3.2 GB`. */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits).replace(/\.0$/, "")} ${UNITS[unit] ?? "bytes"}`;
}
