/**
 * @file The orders the Library plays in: its items, each album whole, or every song.
 *
 * An item is a song or an album in one file; a file split into songs plays as its
 * songs, in their order. Each order says which unit a Track belongs to, so a
 * shuffle moves a unit as a whole: a split file's songs, or an album's.
 */

import type { Track } from "../api";
import type { UnitOf } from "../player/usePlayer";
import { albumKey } from "./favoriteGroups";
import { albumArtistOf } from "./views";

/** Return the songs of each split file, in their order, by the file's id. */
export function songsByFile(tracks: readonly Track[]): Map<number, Track[]> {
  const found = new Map<number, Track[]>();
  for (const track of tracks) {
    if (track.segment_of !== null) {
      const songs = found.get(track.segment_of) ?? [];
      songs.push(track);
      found.set(track.segment_of, songs);
    }
  }
  for (const songs of found.values()) {
    songs.sort(byPlace);
  }
  return found;
}

/** Return `items` as they play: each in its place, a split file as its songs. */
export function inLibraryOrder(
  items: readonly Track[],
  songsIn: ReadonlyMap<number, readonly Track[]>,
): Track[] {
  return items.flatMap((item) => (item.split ? (songsIn.get(item.id) ?? []) : [item]));
}

/** A split file's songs are one unit. */
export const fileUnit: UnitOf = (track) =>
  track.segment_of === null ? undefined : `file:${String(track.segment_of)}`;

/** Return `tracks` an album at a time, each in its track order, as the albums first appear. */
export function byAlbum(tracks: readonly Track[]): Track[] {
  const albums = new Map<string, Track[]>();
  for (const track of tracks) {
    const key = albumUnit(track);
    const album = albums.get(key) ?? [];
    album.push(track);
    albums.set(key, album);
  }
  return [...albums.values()].flatMap((album) => album.sort(byPlace));
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Return `tracks` an album at a time, the albums by artist and then name, as Albums lists them. */
export function everyAlbum(tracks: readonly Track[]): Track[] {
  return byAlbum(
    [...tracks].sort(
      (a, b) =>
        collator.compare(albumArtistOf(a), albumArtistOf(b)) || collator.compare(a.album, b.album),
    ),
  );
}

/** An album's songs are one unit, by its album artist and name as the Albums view groups them. */
export const albumUnit = (track: Track): string =>
  `album:${albumKey(albumArtistOf(track), track.album)}`;

/** Return the songs among `tracks`: an album in one file, not split, is left out. */
export function bySong(tracks: readonly Track[]): Track[] {
  return tracks.filter((track) => track.kind === "song" && !track.split);
}

/** By disc and then track number, one with neither keeping its place after those with them. */
function byPlace(a: Track, b: Track): number {
  return (
    (a.disc_number ?? Infinity) - (b.disc_number ?? Infinity) ||
    (a.track_number ?? Infinity) - (b.track_number ?? Infinity)
  );
}
