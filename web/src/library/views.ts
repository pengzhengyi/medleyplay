/**
 * @file The views worked out from the Tracks: artists, albums, favorites, downloads, and search.
 *
 * Pure functions over the Track list, so moving between views asks the server
 * nothing. Names are compared folded: without case, width, or the difference
 * between hiragana and katakana.
 */

import type { Track } from "../api";
import type { ArtistLinks } from "./artistLinks";
import { closestOf, ranked } from "./fuzzy";
import { type Tag, parseQuery } from "./query";
import { ratingOf } from "./ratings";

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
    return groups(tracks, artistNamesOf).map(({ name, count, durationMs }) => ({
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
    for (const name of artistNamesOf(track)) {
      const group = links.groupOf(name);
      const each = found.get(group) ?? {
        names: new Map<string, number>(),
        count: 0,
        durationMs: 0,
      };
      each.names.set(name, (each.names.get(name) ?? 0) + 1);
      each.count += 1;
      each.durationMs += track.duration_ms ?? 0;
      found.set(group, each);
    }
  }
  return [...found.entries()]
    .map(([group, { names, count, durationMs }]) => {
      const link = [...names].reduce((best, next) => (next[1] > best[1] ? next : best))[0];
      return { name: links.shownAsOf(group) ?? link, link, count, durationMs };
    })
    .sort((a, b) => collator.compare(a.name, b.name) || collator.compare(a.link, b.link));
}

/**
 * Return the artists a Track counts under: each its artist names, if the name was split,
 * or else the name as written, blank for none.
 */
export function artistNamesOf(track: Track): readonly string[] {
  return track.artists.length > 0 ? track.artists : [track.artist];
}

/**
 * Return the Tracks of the artist `name`, compared folded, in the order given: those
 * naming it as one of their artists, or as their whole artist as written.
 */
export function tracksOfArtist(
  tracks: readonly Track[],
  name: string,
  links?: ArtistLinks,
): Track[] {
  const keyOf = (each: string) => artistKeyOf(each, links);
  const key = keyOf(name);
  return tracks.filter((track) =>
    [...artistNamesOf(track), track.artist].some((each) => keyOf(each) === key),
  );
}

/** Return each album once, by its artist and then its name. */
export function albumsOf(tracks: readonly Track[]): Album[] {
  return groups(tracks, (track) => [`${albumArtistOf(track)}\n${track.album}`])
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

/**
 * Return the Tracks with a Download kept on the server, and those whose download failed,
 * to try again, in the order given.
 */
export function downloadedOf(tracks: readonly Track[]): Track[] {
  return tracks.filter((track) => track.downloaded || track.download_failed);
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

const NOTHING: Found = { tracks: [], artists: [], albums: [] };

/** What `kind:` keeps, by each word it takes. */
const KINDS: Readonly<Record<string, keyof Found>> = {
  song: "tracks",
  songs: "tracks",
  album: "albums",
  albums: "albums",
  artist: "artists",
  artists: "artists",
};

/**
 * Return the Tracks, artists, and albums `query` asks for, as {@link parseQuery} reads
 * it. Its tags keep the Tracks that fit them; among those, its words find the songs,
 * artists, and albums whose names hold them, side by side first and then loosely, and
 * no words find all. `kind:` keeps only songs, albums, or artists. An artist is found
 * by any name it goes by, as `links` know them. A search asking nothing finds none.
 */
export function search(tracks: readonly Track[], query: string, links?: ArtistLinks): Found {
  const { tags, words } = parseQuery(query);
  const asked = tags.filter((tag) => tag.value.trim() !== "");
  const folded = fold(words).trim();
  if (asked.length === 0 && folded === "") {
    return NOTHING;
  }
  const kept = asked.reduce<readonly Track[]>((left, tag) => fitting(left, tag, links), tracks);
  const kinds = new Set(
    asked.flatMap((tag) => {
      const kind = tag.field === "kind" ? KINDS[fold(tag.value).trim()] : undefined;
      return kind === undefined ? [] : [kind];
    }),
  );
  const shows = (kind: keyof Found) => kinds.size === 0 || kinds.has(kind);
  if (kept.length === tracks.length && folded === "") {
    // Only tags that keep every Track, such as kind:albums, list them all.
    return {
      tracks: shows("tracks") ? kept : [],
      artists: shows("artists") ? artistsOf(tracks, links) : [],
      albums: shows("albums") ? albumsOf(tracks) : [],
    };
  }
  // An artist or album is listed whole, with all its songs, when a song the tags keep is its.
  const keptArtists = new Set(
    kept.flatMap((track) => artistNamesOf(track).map((name) => artistKeyOf(name, links))),
  );
  const keptAlbums = new Set(kept.map(albumKeyOf));
  const artistTags = asked.filter((tag) => tag.field === "artist");
  const artists = artistsOf(tracks, links).filter(
    (artist) =>
      keptArtists.has(artistKeyOf(artist.link, links)) &&
      artistTags.every(
        (tag) =>
          closestOf([artist], fold(tag.value).trim(), (each) => namesOf(each.link, links)).length >
          0,
      ),
  );
  return {
    tracks: shows("tracks") ? ranked(kept, folded, haystackOf) : [],
    artists: shows("artists")
      ? ranked(artists, folded, (artist) => namesOf(artist.link, links))
      : [],
    albums: shows("albums")
      ? ranked(
          albumsOf(tracks).filter((album) => keptAlbums.has(albumKeyOf(album))),
          folded,
          (album) => fold(album.name),
        )
      : [],
  };
}

/** Return the key an artist's songs are grouped by: its linked artist's, or its name's. */
function artistKeyOf(name: string, links?: ArtistLinks): string {
  return links === undefined ? fold(name) : links.groupOf(name);
}

/** Return the key an album's songs are grouped by, from a Track or the album. */
function albumKeyOf(of: Track | Album): string {
  return "title" in of
    ? fold(`${albumArtistOf(of)}\n${of.album}`)
    : fold(`${of.artist}\n${of.name}`);
}

/** Return the `tracks` that fit `tag`: a name close to its value, or its rating or heart. */
function fitting(tracks: readonly Track[], tag: Tag, links?: ArtistLinks): readonly Track[] {
  const value = fold(tag.value).trim();
  switch (tag.field) {
    case "artist": {
      const namesOfTrack = (track: Track) => [
        ...artistNamesOf(track),
        track.artist,
        albumArtistOf(track),
      ];
      const names = new Set(
        closestOf([...new Set(tracks.flatMap(namesOfTrack))], value, (name) =>
          namesOf(name, links),
        ),
      );
      return tracks.filter((track) => namesOfTrack(track).some((name) => names.has(name)));
    }
    case "album": {
      const names = new Set(
        closestOf([...new Set(tracks.map((track) => track.album))], value, fold),
      );
      return tracks.filter((track) => names.has(track.album));
    }
    case "song": {
      const found = new Set(closestOf(tracks, value, (track) => fold(track.title)));
      return tracks.filter((track) => found.has(track));
    }
    case "rating": {
      const least = Number.parseInt(value, 10);
      return Number.isNaN(least)
        ? tracks
        : tracks.filter((track) => (ratingOf(track) ?? 0) >= least);
    }
    case "favorite":
      return value.startsWith("y")
        ? tracks.filter((track) => track.favorite)
        : value.startsWith("n")
          ? tracks.filter((track) => !track.favorite)
          : tracks;
    case "kind":
      return tracks;
  }
}

/** Return every name the artist `name` goes by, folded, one to a line. */
function namesOf(name: string, links?: ArtistLinks): string {
  const group = links?.groupOf(name);
  const shown = group === undefined ? undefined : links?.shownAsOf(group);
  const aliases = group === undefined ? [] : (links?.aliasesOf(group) ?? []);
  return fold([name, shown ?? "", ...aliases].join("\n"));
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

/** Group `tracks` by each name `namesOf` gives, folded, sorted by the name the first Track gives. */
function groups(tracks: readonly Track[], namesOf: (track: Track) => readonly string[]): Group[] {
  const found = new Map<string, { -readonly [K in keyof Group]: Group[K] }>();
  for (const track of tracks) {
    const cover = track.cover === "" ? null : track.cover;
    for (const name of namesOf(track)) {
      const key = fold(name);
      const group = found.get(key);
      if (group === undefined) {
        found.set(key, { name, first: track, count: 1, durationMs: track.duration_ms ?? 0, cover });
      } else {
        group.count += 1;
        group.durationMs += track.duration_ms ?? 0;
        group.cover ??= cover;
      }
    }
  }
  return [...found.values()].sort((a, b) => collator.compare(a.name, b.name));
}
