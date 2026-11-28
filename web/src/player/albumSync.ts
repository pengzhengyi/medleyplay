/** @file Refresh complete split albums in the queue when their saved songs change. */

import type { Track } from "../api";
import { type Entry, type Queue, current, withoutEntries } from "./queue";
import { type Stretch, stretchOf } from "./stretch";

export function segmentStretch(track: Track | undefined): Stretch | undefined {
  const start = track?.segment_start_ms;
  if (track === undefined || start == null) return undefined;
  return stretchOf({
    start_ms: start,
    end_ms: track.duration_ms === null ? null : start + track.duration_ms,
  });
}

export function splitChanged(before: Track | undefined, after: Track | undefined): boolean {
  if (before?.segment_of == null && after?.segment_of == null) return false;
  return (
    before?.segment_of !== after?.segment_of ||
    before?.segment_start_ms !== after?.segment_start_ms ||
    before?.duration_ms !== after?.duration_ms
  );
}

export function fileSongs(tracks: ReadonlyMap<number, Track>, fileId: number): Track[] {
  return [...tracks.values()].filter((track) => track.segment_of === fileId).sort(byStart);
}

const byStart = (a: Track, b: Track) =>
  (a.segment_start_ms ?? Infinity) - (b.segment_start_ms ?? Infinity);

export function withoutDeletedSongs(
  queue: Queue,
  before: ReadonlyMap<number, Track>,
  after: ReadonlyMap<number, Track>,
): Queue {
  return withoutEntries(
    queue,
    (entry) =>
      !after.has(entry.trackId) &&
      (before.get(entry.trackId)?.segment_of != null || albumUnit(entry)),
  );
}

const albumUnit = (entry: Entry): boolean =>
  entry.unit?.startsWith("file:") === true || entry.unit?.startsWith("album:") === true;

/** Replace each upcoming album that still has its whole old song list in order. */
export function updateUpcomingAlbums(
  queue: Queue,
  before: ReadonlyMap<number, Track>,
  after: ReadonlyMap<number, Track>,
  keyFor: () => string,
): Queue {
  const from = queue.position + 1;
  if (before.size === 0 || from >= queue.entries.length) return queue;
  const updates = songListUpdates(before, after);
  if (updates.size === 0) return queue;
  let entries: Entry[] | undefined;
  let order: string[] | undefined;
  let position = from;
  while (position < (entries ?? queue.entries).length) {
    const queued = entries ?? queue.entries;
    const first = queued[position];
    const file = first === undefined ? undefined : before.get(first.trackId)?.segment_of;
    const update = file == null ? undefined : updates.get(file);
    if (first === undefined || !albumUnit(first) || update?.old[0]?.id !== first.trackId) {
      position++;
      continue;
    }
    const run = queued.slice(position, position + update.old.length);
    if (!isComplete(run, update.old, first.unit)) {
      position++;
      continue;
    }
    const own = order ?? queue.order;
    const ownFrom = own?.indexOf(first.key) ?? -1;
    if (own !== undefined && !inOwnOrder(run, own, ownFrom)) {
      position++;
      continue;
    }
    const next = replacementOf(run, update.songs, update.file, keyFor);
    entries ??= [...queue.entries];
    entries.splice(position, run.length, ...next);
    if (own !== undefined) {
      order ??= [...own];
      order.splice(ownFrom, run.length, ...next.map((entry) => entry.key));
    }
    position += next.length;
  }
  return entries === undefined ? queue : { ...queue, entries, order };
}

function songListUpdates(before: ReadonlyMap<number, Track>, after: ReadonlyMap<number, Track>) {
  const changed = new Set<number>();
  for (const [id, prior] of before) {
    const file = prior.segment_of;
    if (file == null) continue;
    const next = after.get(id);
    if (file !== next?.segment_of || prior.segment_start_ms !== next.segment_start_ms) {
      changed.add(file);
    }
  }
  for (const [id, next] of after) {
    const file = next.segment_of;
    if (file != null && file !== before.get(id)?.segment_of) changed.add(file);
  }
  if (changed.size === 0) return new Map<number, SongListUpdate>();
  const old = songsIn(before, changed);
  const current = songsIn(after, changed);
  const updates = new Map<number, SongListUpdate>();
  for (const [fileId, prior] of old) {
    const file = after.get(fileId);
    if (file === undefined) continue;
    const songs = file.split ? (current.get(fileId) ?? []) : [file];
    if (songs.length > 0 && !sameTrackIds(prior, songs)) {
      updates.set(fileId, { file: fileId, old: prior, songs });
    }
  }
  return updates;
}

interface SongListUpdate {
  readonly file: number;
  readonly old: readonly Track[];
  readonly songs: readonly Track[];
}

function songsIn(tracks: ReadonlyMap<number, Track>, files: ReadonlySet<number>) {
  const result = new Map<number, Track[]>();
  for (const track of tracks.values()) {
    const file = track.segment_of;
    if (file == null || !files.has(file)) continue;
    const songs = result.get(file);
    if (songs === undefined) result.set(file, [track]);
    else songs.push(track);
  }
  for (const songs of result.values()) songs.sort(byStart);
  return result;
}

const sameTrackIds = (old: readonly Track[], updated: readonly Track[]) =>
  updated.length === old.length && updated.every((song, i) => song.id === old[i]?.id);

const isComplete = (entries: readonly Entry[], songs: readonly Track[], unit: Entry["unit"]) =>
  entries.length === songs.length &&
  entries.every((entry, i) => entry.unit === unit && entry.trackId === songs[i]?.id);

const inOwnOrder = (entries: readonly Entry[], own: readonly string[], from: number) =>
  from >= 0 && entries.every((entry, i) => own[from + i] === entry.key);

function replacementOf(
  run: readonly Entry[],
  songs: readonly Track[],
  file: number,
  keyFor: () => string,
): Entry[] {
  const entries = new Map(run.map((entry) => [entry.trackId, entry]));
  const unit = run[0]?.unit;
  return songs.map(
    (song) =>
      entries.get(song.id) ?? {
        key: keyFor(),
        trackId: song.id,
        unit: song.segment_of !== file && unit?.startsWith("file:") === true ? undefined : unit,
      },
  );
}

export function updatePlayingAlbum(
  queue: Queue,
  before: ReadonlyMap<number, Track>,
  after: ReadonlyMap<number, Track>,
  fileSeconds: number | undefined,
  keyFor: () => string,
): Queue | undefined {
  const now = current(queue);
  if (now === undefined) return undefined;
  const fileId = before.get(now.trackId)?.segment_of;
  if (fileId == null) return undefined;
  const file = after.get(fileId);
  if (file === undefined) return undefined;

  const old = fileSongs(before, fileId);
  const offset = old.findIndex((song) => song.id === now.trackId);
  if (offset < 0 || offset > queue.position) return undefined;
  const from = queue.position - offset;
  const run = queue.entries.slice(from, from + old.length);
  if (!isComplete(run, old, now.unit)) return undefined;

  const updated = file.split ? fileSongs(after, fileId) : [file];
  if (updated.length === 0) return undefined;
  const sameSongs = sameTrackIds(old, updated);
  if (sameSongs && !updated.some((song, i) => splitChanged(old[i], song))) return undefined;

  const found = updated.findIndex((song) => song.id === now.trackId);
  const playingIndex =
    indexAt(updated, fileSeconds) ?? (found < 0 ? Math.min(offset, updated.length - 1) : found);
  const position = from + playingIndex;
  if (sameSongs) return position === queue.position ? queue : { ...queue, position };

  const orderFrom = queue.order?.indexOf(run[0]?.key ?? "") ?? -1;
  if (queue.order !== undefined && !inOwnOrder(run, queue.order, orderFrom)) {
    return undefined;
  }
  const replacement = replacementOf(run, updated, fileId, keyFor);
  return {
    ...queue,
    entries: [
      ...queue.entries.slice(0, from),
      ...replacement,
      ...queue.entries.slice(from + run.length),
    ],
    position,
    order:
      queue.order === undefined
        ? undefined
        : [
            ...queue.order.slice(0, orderFrom),
            ...replacement.map((entry) => entry.key),
            ...queue.order.slice(orderFrom + run.length),
          ],
  };
}

function indexAt(songs: readonly Track[], position: number | undefined): number | undefined {
  if (position === undefined || songs[0]?.segment_start_ms == null) return undefined;
  return Math.max(
    0,
    songs.findLastIndex((song) => (song.segment_start_ms ?? Infinity) <= position * 1000),
  );
}
