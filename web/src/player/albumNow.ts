/**
 * @file What plays now, as Now Playing shows it: a song, or an album and where in it.
 *
 * An album plays as the entries next to each other with the current entry's unit,
 * such as a split file's songs or an album's in Album order, in the order they
 * play; the same album queued twice in a row is two albums, told apart where a
 * song comes again. A whole album in one file is an album with no songs known. A
 * unit of one song, or of songs with no album named, plays as a song. Each song
 * has its place on the album's timeline, once every song's length is known.
 */

import type { Track } from "../api";
import { type Entry, type Queue, current } from "./queue";

/** A song of the album playing, and where it starts on the album's timeline. */
export interface AlbumSong {
  readonly entry: Entry;
  readonly track: Track | undefined;
  /** Where it starts, in seconds from the album's start; 0 when a length before it is unknown. */
  readonly start: number;
  /** Its length in seconds, if known. */
  readonly length: number | undefined;
}

/** What plays now: a song, or an album. */
export type Playing =
  | { readonly kind: "song" }
  | {
      readonly kind: "album";
      /** The album's songs in the order they play; none for a whole album in one file. */
      readonly songs: readonly AlbumSong[];
      /** The place of the song playing among `songs`. */
      readonly current: number;
      /** The album's length in seconds, once every song's length is known. */
      readonly length: number | undefined;
    };

const SONG: Playing = { kind: "song" };

/** Return what plays now in `queue`, looking its Tracks up in `tracks`. */
export function playingOf(queue: Queue, tracks: ReadonlyMap<number, Track>): Playing {
  const now = current(queue);
  if (now === undefined) {
    return SONG;
  }
  if (now.unit === undefined) {
    return tracks.get(now.trackId)?.kind === "album"
      ? { kind: "album", songs: [], current: -1, length: undefined }
      : SONG;
  }
  if (now.unit.startsWith("album:") && tracks.get(now.trackId)?.album === "") {
    return SONG;
  }
  const { first, last } = runAround(queue.entries, queue.position);
  if (first === last) {
    return SONG;
  }
  const { entries, position } = queue;
  let start: number | undefined = 0;
  const songs: AlbumSong[] = [];
  for (const entry of entries.slice(first, last + 1)) {
    const track = tracks.get(entry.trackId);
    const ms = track?.duration_ms ?? undefined;
    const length = ms === undefined ? undefined : ms / 1000;
    songs.push({ entry, track, start: start ?? 0, length });
    // Past a song of unknown length, no song has a place on the timeline.
    start = start === undefined || length === undefined ? undefined : start + length;
  }
  return { kind: "album", songs, current: position - first, length: start };
}

/**
 * Return the first and last place of the run of entries around `position` with its
 * entry's unit: of the entries next to each other with that unit, read in order,
 * a run starts again wherever a Track comes a second time.
 */
function runAround(
  entries: readonly Entry[],
  position: number,
): { readonly first: number; readonly last: number } {
  const unit = entries[position]?.unit;
  let blockStart = position;
  while (entries[blockStart - 1]?.unit === unit) {
    blockStart--;
  }
  let first = blockStart;
  let seen = new Set<number>();
  for (let place = blockStart; entries[place]?.unit === unit; place++) {
    const trackId = entries[place]?.trackId ?? -1;
    if (seen.has(trackId)) {
      if (place > position) {
        return { first, last: place - 1 };
      }
      first = place;
      seen = new Set();
    }
    seen.add(trackId);
  }
  let last = position;
  while (entries[last + 1]?.unit === unit) {
    last++;
  }
  return { first, last };
}

/** Return the song of `songs` playing at `seconds` into the album, and how far into it. */
export function songAt(
  songs: readonly AlbumSong[],
  seconds: number,
): { readonly index: number; readonly within: number } | undefined {
  for (const [index, song] of songs.entries()) {
    const end = song.start + (song.length ?? 0);
    if (seconds < end || index === songs.length - 1) {
      return { index, within: Math.max(0, Math.min(seconds - song.start, song.length ?? 0)) };
    }
  }
  return undefined;
}
