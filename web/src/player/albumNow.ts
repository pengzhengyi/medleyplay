/**
 * @file What plays now, as Now Playing shows it: a song, or an album and where in it.
 *
 * An album plays as the entries next to each other with the current entry's unit,
 * such as a split file's songs or an album's in Album order, or, with no unit,
 * songs of one split file queued one after another, as Up next shows them, in
 * the order they play; the same album queued twice in a row is two albums, told apart where a
 * song comes again. A whole album in one file is an album with no songs known, until it is
 * split: playing on whole, it is then an album of its songs, the one under the position playing. A
 * unit of one song, or of songs with no album named, plays as a song. Each song
 * has its place on the album's timeline, once every song's length is known.
 */

import type { Track } from "../api";
import { songsByFile } from "../library/playOrder";
import { type Entry, type Queue, RESTART_AFTER, current } from "./queue";

/** A song of the album playing, and where it starts on the album's timeline. */
export interface AlbumSong {
  readonly entry: Entry;
  readonly track: Track | undefined;
  /** Where it starts, in seconds from the album's start; 0 when a length before it is unknown. */
  readonly start: number;
  /** Where it starts in the Track that plays it: 0 for a Track of its own, its start in a file playing whole. */
  readonly from: number;
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

/**
 * Return the song playing in `track`: the Track itself for a song, the song an album
 * has reached, or `undefined` for a whole album in one file, which has none.
 */
export function songPlaying(track: Track, playing: Playing): Track | undefined {
  if (track.kind !== "album") {
    return track;
  }
  return playing.kind === "album" ? playing.songs[playing.current]?.track : undefined;
}

/** Return what plays now in `queue`, `position` seconds into its Track, looking Tracks up in `tracks`. */
export function playingOf(queue: Queue, tracks: ReadonlyMap<number, Track>, position = 0): Playing {
  const now = current(queue);
  if (now === undefined) {
    return SONG;
  }
  const playingTrack = tracks.get(now.trackId);
  if (now.unit === undefined && playingTrack?.segment_of == null) {
    if (playingTrack?.kind !== "album") {
      return SONG;
    }
    return playingTrack.split
      ? wholeFileOf(now, playingTrack, tracks, position)
      : { kind: "album", songs: [], current: -1, length: undefined };
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
  const { entries } = queue;
  let start: number | undefined = 0;
  const songs: AlbumSong[] = [];
  for (const entry of entries.slice(first, last + 1)) {
    const track = tracks.get(entry.trackId);
    const ms = track?.duration_ms ?? undefined;
    const length = ms === undefined ? undefined : ms / 1000;
    songs.push({ entry, track, start: start ?? 0, from: 0, length });
    // Past a song of unknown length, no song has a place on the timeline.
    start = start === undefined || length === undefined ? undefined : start + length;
  }
  return { kind: "album", songs, current: queue.position - first, length: start };
}

/**
 * Return a split file playing whole as an album of its songs, in their order, each
 * starting in the file where the lengths before it end; the song under `position` plays.
 */
function wholeFileOf(
  entry: Entry,
  file: Track,
  tracks: ReadonlyMap<number, Track>,
  position: number,
): Playing {
  const ordered = songsByFile([...tracks.values()]).get(file.id) ?? [];
  let start: number | undefined = 0;
  const songs: AlbumSong[] = [];
  for (const track of ordered) {
    const length = track.duration_ms === null ? undefined : track.duration_ms / 1000;
    songs.push({ entry, track, start: start ?? 0, from: start ?? 0, length });
    start = start === undefined || length === undefined ? undefined : start + length;
  }
  if (songs.length === 0) {
    return { kind: "album", songs: [], current: -1, length: undefined };
  }
  const at = start === undefined ? undefined : songAt(songs, Math.min(position, start));
  return { kind: "album", songs, current: at?.index ?? 0, length: start };
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

/**
 * The album playing as one timeline: where it is, its length, each song's start,
 * and a seek that plays the song the second falls in, from that many seconds into
 * the Track that plays it. `undefined` unless an album of songs plays and every
 * song's length is known.
 */
export function albumTimeline(
  playing: Playing,
  position: number,
  playSong: (song: AlbumSong, seconds: number) => void,
):
  | {
      readonly position: number;
      readonly length: number;
      readonly marks: readonly { readonly start: number; readonly title: string }[];
      readonly seek: (seconds: number) => void;
    }
  | undefined {
  if (playing.kind !== "album" || playing.length === undefined || playing.songs.length === 0) {
    return undefined;
  }
  const { songs, current, length } = playing;
  const now = songs[current];
  if (now === undefined) {
    return undefined;
  }
  // A song's real length can differ a little from its details', so it stays within its own.
  const within = Math.min(Math.max(position - now.from, 0), now.length ?? position);
  return {
    position: now.start + within,
    length,
    marks: songs.map((song) => ({ start: song.start, title: song.track?.title ?? "" })),
    seek: (seconds) => {
      const at = songAt(songs, Math.min(Math.max(seconds, 0), length));
      const song = at === undefined ? undefined : songs[at.index];
      if (at !== undefined && song !== undefined) {
        playSong(song, song.from + at.within);
      }
    },
  };
}

/** Where a step goes: the entry to play, and the second of it to play from. */
export interface Step {
  readonly key: string;
  readonly seconds: number;
}

/** Where to step by song and by album; a song step is `undefined` with none to step to. */
export interface AlbumSteps {
  readonly previousSong: Step | undefined;
  readonly nextSong: Step | undefined;
  readonly previousAlbum: Step;
  readonly nextAlbum: Step | undefined;
}

/**
 * Return where to step from what plays now, `position` seconds into its Track, while an
 * album plays: by song within it, and by album past it. Back goes to the start of the
 * song, or of the album, once it is a few seconds in, as Previous does.
 */
export function albumSteps(
  queue: Queue,
  tracks: ReadonlyMap<number, Track>,
  playing: Playing,
  position: number,
): AlbumSteps | undefined {
  const now = current(queue);
  if (playing.kind !== "album" || now === undefined) {
    return undefined;
  }
  const { songs } = playing;
  const song = songs[playing.current];
  const startOf = (each: AlbumSong): Step => ({ key: each.entry.key, seconds: each.from });
  const places = songs.map(({ entry }) => queue.entries.indexOf(entry));
  const first = songs.length === 0 ? queue.position : Math.min(...places);
  const last = songs.length === 0 ? queue.position : Math.max(...places);
  const opening: Step = songs[0] === undefined ? { key: now.key, seconds: 0 } : startOf(songs[0]);
  const intoSong = song === undefined ? position : position - song.from;
  const intoAlbum = song === undefined ? position : song.start + intoSong;
  const before = songs[playing.current - 1];
  const after = songs[playing.current + 1];
  const nextEntry = queue.entries[last + 1];
  const previousEntry = queue.entries[runStart(queue, tracks, first - 1)];
  return {
    previousSong:
      song === undefined
        ? undefined
        : intoSong > RESTART_AFTER || before === undefined
          ? startOf(song)
          : startOf(before),
    nextSong: after === undefined ? undefined : startOf(after),
    previousAlbum:
      intoAlbum > RESTART_AFTER || previousEntry === undefined
        ? opening
        : { key: previousEntry.key, seconds: 0 },
    nextAlbum: nextEntry === undefined ? undefined : { key: nextEntry.key, seconds: 0 },
  };
}

/** A command that steps: by song, or by album. */
export type StepCommand = "previous" | "next" | "previousAlbum" | "nextAlbum";

/**
 * Return where `command` steps to while an album plays: Previous and Next by song,
 * going on by album past the album's ends or where no songs are known, and the album
 * commands by album; `undefined` with none to step to.
 */
export function stepFor(steps: AlbumSteps, command: StepCommand): Step | undefined {
  switch (command) {
    case "previous":
      return steps.previousSong ?? steps.previousAlbum;
    case "next":
      return steps.nextSong ?? steps.nextAlbum;
    case "previousAlbum":
      return steps.previousAlbum;
    case "nextAlbum":
      return steps.nextAlbum;
  }
}

/** Return the first place of the album, or the song of its own, at `place`; -1 for none. */
function runStart(queue: Queue, tracks: ReadonlyMap<number, Track>, place: number): number {
  const entry = queue.entries[place];
  if (entry === undefined) {
    return -1;
  }
  if (entry.unit === undefined && tracks.get(entry.trackId)?.segment_of == null) {
    return place;
  }
  const groupOf = (each: Entry | undefined) =>
    each === undefined
      ? undefined
      : (each.unit ?? `file:${String(tracks.get(each.trackId)?.segment_of ?? "")}`);
  return runAround(queue.entries, place, groupOf).first;
}
