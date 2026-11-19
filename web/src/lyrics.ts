/**
 * @file Lyrics as a song plays: the line sung at a time, how far into the song playing
 * it is, and whether this browser shows them.
 */

import type { LyricLine, LyricsOption, Track } from "./api";
import { type Playing, songPlaying } from "./player/albumNow";
import { choice } from "./storedChoice";

/**
 * Return the place of the line sung `ms` into the song: the last line starting at or
 * before it, or -1 before the first.
 */
export function lineAt(lines: readonly LyricLine[], ms: number): number {
  let low = 0;
  let high = lines.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if ((lines[middle]?.at_ms ?? Infinity) <= ms) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

/**
 * Return the song playing in `track`, as `playing` places it, where it starts in the
 * Track playing, and how far into it `position` is, in seconds: a song of a file
 * playing whole starts where the file reaches it. A whole album in one file has no song.
 */
export function songTimeOf(
  track: Track,
  playing: Playing,
  position: number,
): { readonly song: Track | undefined; readonly from: number; readonly seconds: number } {
  const song = songPlaying(track, playing);
  const from = playing.kind === "album" ? (playing.songs[playing.current]?.from ?? 0) : 0;
  return { song, from, seconds: Math.max(0, position - from) };
}

const [hide, useHidden] = choice("medleyplay.lyrics", "hidden");

/** Hide the lyrics, or show them, in this browser. */
export const setLyricsHidden: (hidden: boolean) => void = hide;

/** Whether this browser hides the lyrics; they show until it does. */
export const useLyricsHidden: () => boolean = useHidden;

/** How many lines of a song's lyrics show, to tell it apart. */
const LINES_SHOWN = 2;

/** Each lyrics site's name, as the household reads it. */
export const LYRICS_SITE_NAMES: Record<LyricsOption["provider"], string> = {
  lrclib: "LRCLIB",
  netease: "NetEase Cloud Music",
};

/**
 * Return the first lines of lyrics, LRC or plain, as sung: without their times, and
 * without LRC's lines naming the artist or album.
 */
export function firstLinesOf(text: string, count = LINES_SHOWN): readonly string[] {
  return text
    .split("\n")
    .map((line) =>
      line
        .replaceAll(/\[[^\]]*\]/gu, "")
        // A word's time, as enhanced LRC writes it: <00:12.34>.
        .replaceAll(/<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/gu, "")
        .trim(),
    )
    .filter((line) => line !== "")
    .slice(0, count);
}
