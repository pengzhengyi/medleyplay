/**
 * @file What plays now, as Now Playing shows it: a song, or an album and where in it.
 *
 * An album plays as the entries next to each other with the current entry's unit,
 * such as a split file's songs or an album's in Album order, or, with no unit,
 * songs of one split file queued one after another, as Up next shows them, in
 * the order they play; the same album queued twice in a row is two albums, told apart where a
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
  const playingTrack = tracks.get(now.trackId);
  if (now.unit === undefined && playingTrack?.segment_of == null) {
    return playingTrack?.kind === "album"
      ? { kind: "album", songs: [], current: -1, length: undefined }
      : SONG;
  }
  if (now.unit?.startsWith("album:") === true && playingTrack?.album === "") {
    return SONG;
  }
  const groupOf = (entry: Entry | undefined) =>
    entry === undefined
      ? undefined
      : (entry.unit ?? `file:${String(tracks.get(entry.trackId)?.segment_of ?? "")}`);
  const { first, last } = runAround(queue.entries, queue.position, groupOf);
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
  groupOf: (entry: Entry | undefined) => string | undefined,
): { readonly first: number; readonly last: number } {
  const group = groupOf(entries[position]);
  const inGroup = (place: number) => groupOf(entries[place]) === group;
  let blockStart = position;
  while (inGroup(blockStart - 1)) {
    blockStart--;
  }
  let first = blockStart;
  let seen = new Set<number>();
  for (let place = blockStart; inGroup(place); place++) {
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
  while (inGroup(last + 1)) {
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
