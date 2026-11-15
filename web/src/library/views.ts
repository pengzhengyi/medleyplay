/**
 * @file The views worked out from the Tracks: artists, albums, favorites, downloads, and search.
 *
 * Pure functions over the Track list, so moving between views asks the server
 * nothing. Names are compared folded: without case, width, or the difference
 * between hiragana and katakana.
 */

import type { Track } from "../api";
import type { ArtistLinks } from "./artistLinks";

/** A group of Tracks, with how many there are and how long they play. */
interface Listed {
  readonly name: string;
  readonly count: number;
  readonly durationMs: number;
}

/** An artist, with how many Tracks are theirs and how long they play. */
export interface Artist extends Listed {
  /**
   * The name it is shown by: as the household chose, or as most of its Tracks write
   * it; `""` for Tracks with no artist.
   */
  readonly name: string;
  /** The name most of its Tracks write, which opens its page and keeps its heart. */
  readonly link: string;
}

/** An album, under its album artist, or its artist when that is blank. */
export interface Album extends Listed {
  readonly artist: string;
  /** The first cover among the album's songs, in the order given. */
  readonly cover: string | null;
}

/** What a search found. */
export interface Found {
  readonly tracks: readonly Track[];
  readonly artists: readonly Artist[];
  readonly albums: readonly Album[];
}

const KATAKANA = /[ァ-ヶ]/g;
const HIRAGANA_OFFSET = 0x60;

/** Return `text` as search compares it: NFKC, lower case, and katakana as hiragana. */
export function fold(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(KATAKANA, (kana) => String.fromCharCode(kana.charCodeAt(0) - HIRAGANA_OFFSET));
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Return the Tracks that stand for music in the Library: a file split into songs gives way to them. */
export function songsOf(tracks: readonly Track[]): Track[] {
  return tracks.filter((track) => !track.split);
}

/**
 * Return each artist once, sorted by name as people read them, a blank name first,
 * and then by the name its Tracks write.
 */
export function artistsOf(tracks: readonly Track[], links?: ArtistLinks): Artist[] {
  if (links === undefined) {
    return groups(tracks, (track) => track.artist).map(({ name, count, durationMs }) => ({
      name,
      link: name,
      count,
      durationMs,
    }));
  }
  // Names linked to one artist are one, named as the household chose, or as most of its Tracks write it.
  const found = new Map<
    string,
    { names: Map<string, number>; count: number; durationMs: number }
  >();
  for (const track of tracks) {
    const group = links.groupOf(track.artist);
    const each = found.get(group) ?? { names: new Map<string, number>(), count: 0, durationMs: 0 };
    each.names.set(track.artist, (each.names.get(track.artist) ?? 0) + 1);
    each.count += 1;
    each.durationMs += track.duration_ms ?? 0;
    found.set(group, each);
  }
  return [...found.entries()]
    .map(([group, { names, count, durationMs }]) => {
      const link = [...names].reduce((best, next) => (next[1] > best[1] ? next : best))[0];
      return { name: links.shownAsOf(group) ?? link, link, count, durationMs };
    })
    .sort((a, b) => collator.compare(a.name, b.name) || collator.compare(a.link, b.link));
}

/** Return the Tracks of the artist `name`, compared folded, in the order given. */
export function tracksOfArtist(
  tracks: readonly Track[],
  name: string,
  links?: ArtistLinks,
): Track[] {
  if (links === undefined) {
    const key = fold(name);
    return tracks.filter((track) => fold(track.artist) === key);
  }
  const group = links.groupOf(name);
  return tracks.filter((track) => links.groupOf(track.artist) === group);
}

/** Return each album once, by its artist and then its name. */
export function albumsOf(tracks: readonly Track[]): Album[] {
  return groups(tracks, (track) => `${albumArtistOf(track)}\n${track.album}`)
    .map(({ first, count, durationMs, cover }) => ({
      artist: albumArtistOf(first),
      name: first.album,
      count,
      durationMs,
      cover,
    }))
    .sort((a, b) => collator.compare(a.artist, b.artist) || collator.compare(a.name, b.name));
}

/** Return the Tracks of the album `name` by `artist`, compared folded, in the order given. */
export function tracksOfAlbum(tracks: readonly Track[], artist: string, name: string): Track[] {
  const artistKey = fold(artist);
  const nameKey = fold(name);
  return tracks.filter(
    (track) => fold(albumArtistOf(track)) === artistKey && fold(track.album) === nameKey,
  );
}

/**
 * Return the one file an album is, if it is one: the file its songs were split from,
 * listed among them or not, or the album itself as one file not yet split.
 */
export function albumFileOf(
  album: readonly Track[],
  byId: ReadonlyMap<number, Track>,
): Track | undefined {
  const files = new Set(album.map((track) => track.segment_of ?? track.id));
  const [only] = files;
  if (files.size !== 1 || only === undefined) {
    return undefined;
  }
  const file = byId.get(only);
  return file?.kind === "album" ? file : undefined;
}

/** Return the favorite Tracks newest added first, the order of the server's Favorites. */
export function favoritesOf(tracks: readonly Track[]): Track[] {
  return tracks
    .filter((track) => track.favorite)
    .sort((a, b) => b.added_at.localeCompare(a.added_at) || b.id - a.id);
}

/** Return the Tracks with a Download kept on the server, in the order given. */
export function downloadedOf(tracks: readonly Track[]): Track[] {
  return tracks.filter((track) => track.downloaded);
}

const haystacks = new WeakMap<Track, string>();

/** Return a Track's title, artist, and album folded, worked out once for each Track. */
function haystackOf(track: Track): string {
  let found = haystacks.get(track);
  if (found === undefined) {
    found = fold(`${track.title}\n${track.artist}\n${track.album}`);
    haystacks.set(track, found);
  }
  return found;
}

/**
 * Return the Tracks, artists, and albums with every word of `query`; a blank query
 * finds none. An artist is found by any name it goes by, as `links` know them.
 */
export function search(tracks: readonly Track[], query: string, links?: ArtistLinks): Found {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return { tracks: [], artists: [], albums: [] };
  }
  const matches = (text: string) => words.every((word) => text.includes(word));
  return {
    tracks: tracks.filter((track) => matches(haystackOf(track))),
    artists: artistsOf(tracks, links).filter(
      (artist) =>
        matches(fold(artist.name)) ||
        (links?.aliasesOf(links.groupOf(artist.link)) ?? []).some((alias) => matches(fold(alias))),
    ),
    albums: albumsOf(tracks).filter((album) => matches(fold(album.name))),
  };
}

/** Return the artist a Track's album is listed under: its album artist, or its artist. */
export function albumArtistOf(track: Track): string {
  return track.album_artist === "" ? track.artist : track.album_artist;
}

interface Group {
  readonly name: string;
  readonly first: Track;
  readonly count: number;
  readonly durationMs: number;
  readonly cover: string | null;
}

/** Group `tracks` by `nameOf`, folded, sorted by the name the first Track gives. */
function groups(tracks: readonly Track[], nameOf: (track: Track) => string): Group[] {
  const found = new Map<string, { -readonly [K in keyof Group]: Group[K] }>();
  for (const track of tracks) {
    const name = nameOf(track);
    const key = fold(name);
    const group = found.get(key);
    const cover = track.cover === "" ? null : track.cover;
    if (group === undefined) {
      found.set(key, { name, first: track, count: 1, durationMs: track.duration_ms ?? 0, cover });
    } else {
      group.count += 1;
      group.durationMs += track.duration_ms ?? 0;
      group.cover ??= cover;
    }
  }
  return [...found.values()].sort((a, b) => collator.compare(a.name, b.name));
}
