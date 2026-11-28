/** @file Refresh the playing album from the songs and boundaries saved for its file. */

import type { Track } from "../api";
import { type Queue, current, withoutTracks } from "./queue";
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
  return [...tracks.values()]
    .filter((track) => track.segment_of === fileId)
    .sort((a, b) => (a.segment_start_ms ?? Infinity) - (b.segment_start_ms ?? Infinity));
}

export function withoutDeletedSongs(
  queue: Queue,
  before: ReadonlyMap<number, Track>,
  after: ReadonlyMap<number, Track>,
): Queue {
  return withoutTracks(
    queue,
    (trackId) => before.get(trackId)?.segment_of != null && !after.has(trackId),
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
  if (
    run.length !== old.length ||
    !run.every((entry, index) => entry.unit === now.unit && entry.trackId === old[index]?.id)
  )
    return undefined;

  const updated = file.split ? fileSongs(after, fileId) : [file];
  if (updated.length === 0) return undefined;
  const sameSongs =
    updated.length === old.length && updated.every((song, i) => song.id === old[i]?.id);
  if (sameSongs && !updated.some((song, i) => splitChanged(old[i], song))) return undefined;

  const entries = new Map(run.map((entry) => [entry.trackId, entry]));
  const found = updated.findIndex((song) => song.id === now.trackId);
  const playingIndex =
    indexAt(updated, fileSeconds) ?? (found < 0 ? Math.min(offset, updated.length - 1) : found);
  const position = from + playingIndex;
  if (sameSongs) return position === queue.position ? queue : { ...queue, position };

  const replacement = updated.map(
    (song) =>
      entries.get(song.id) ?? {
        key: keyFor(),
        trackId: song.id,
        unit:
          song.segment_of !== fileId && now.unit?.startsWith("file:") === true
            ? undefined
            : now.unit,
      },
  );
  const orderFrom = queue.order?.indexOf(run[0]?.key ?? "") ?? -1;
  if (
    queue.order !== undefined &&
    (orderFrom < 0 || !run.every((entry, i) => queue.order?.[orderFrom + i] === entry.key))
  ) {
    return undefined;
  }
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
