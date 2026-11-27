/**
 * @file The views worked out from the Tracks: artists, albums, favorites, downloads, and search.
 *
 * Pure functions over the Track list, so moving between views asks the server
 * nothing. Names are compared folded: without case, width, or the difference
 * between hiragana and katakana.
 */

import type { Playlist, Track } from "../api";
import type { Route } from "../routes";
import type { ArtistLinks } from "./artistLinks";
import { closestOf, ranked } from "./fuzzy";
import { type Tag, parseQuery } from "./query";
import { ratingOf } from "./ratings";

export function isManualPlaylist(playlist: Playlist): boolean {
  return playlist.builtin === null && playlist.rules === null && playlist.unreadable === "";
}

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
  /** The id of the Library's artist its Tracks are bound to; none for Tracks with no artist. */
  readonly id?: string;
  /** The album most of its Tracks are on, when another artist listed goes by its name. */
  readonly onAlbum?: string;
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
  const ids = artistIdsOf(tracks);
  const withId = <T extends { readonly link: string }>(artist: T): T & { readonly id?: string } => {
    const id = ids.get(fold(artist.link.trim()));
    return id === undefined ? artist : { ...artist, id };
  };
  if (links === undefined) {
    return groups(tracks, artistNamesOf).map(({ name, count, durationMs }) =>
      withId({ name, link: name, count, durationMs }),
    );
  }
  // Names linked to one artist are one, named as the household chose, or as most of its Tracks
  // write it; two artists going by one name are two, each by its id.
  const found = new Map<
    string,
    {
      names: Map<string, number>;
      albums: Map<string, number>;
      count: number;
      durationMs: number;
      id?: string;
    }
  >();
  for (const track of tracks) {
    artistNamesOf(track).forEach((name, place) => {
      const id = track.artist_ids[place];
      const group = links.groupOfBound(name, id);
      const each = found.get(group) ?? {
        names: new Map<string, number>(),
        albums: new Map<string, number>(),
        count: 0,
        durationMs: 0,
      };
      each.names.set(name, (each.names.get(name) ?? 0) + 1);
      if (track.album.trim() !== "") {
        each.albums.set(track.album, (each.albums.get(track.album) ?? 0) + 1);
      }
      each.count += 1;
      each.durationMs += track.duration_ms ?? 0;
      if (each.id === undefined && id !== undefined) {
        each.id = id;
      }
      found.set(group, each);
    });
  }
  const listed = [...found.values()].map(({ names, albums, count, durationMs, id }) => {
    const link = mostOf(names) ?? "";
    const group = links.groupOfBound(link, id);
    const artist = { name: links.shownAsOf(group) ?? link, link, count, durationMs };
    return { artist: id === undefined ? withId(artist) : { ...artist, id }, album: mostOf(albums) };
  });
  const shared = new Map<string, number>();
  for (const { artist } of listed) {
    shared.set(fold(artist.name), (shared.get(fold(artist.name)) ?? 0) + 1);
  }
  return listed
    .map(({ artist, album }): Artist =>
      album !== undefined && (shared.get(fold(artist.name)) ?? 0) > 1
        ? { ...artist, onAlbum: album }
        : artist,
    )
    .sort(
      (a, b) =>
        collator.compare(a.name, b.name) ||
        collator.compare(a.link, b.link) ||
        collator.compare(a.onAlbum ?? "", b.onAlbum ?? ""),
    );
}

/**
 * Return the artists among the Library's whose ids are `ids`, the artists one name names,
 * in the order the name names them; an artist with no song is left out.
 */
export function artistsCalled(
  tracks: readonly Track[],
  links: ArtistLinks,
  ids: readonly string[],
): Artist[] {
  const place = new Map(ids.map((id, index) => [id, index]));
  const placeOf = (artist: Artist) => (artist.id === undefined ? undefined : place.get(artist.id));
  return artistsOf(tracks, links)
    .filter((artist) => placeOf(artist) !== undefined)
    .sort((a, b) => (placeOf(a) ?? 0) - (placeOf(b) ?? 0));
}

/** Return the key `counts` counts most, the first of those counted alike; none for no keys. */
function mostOf(counts: ReadonlyMap<string, number>): string | undefined {
  return [...counts].reduce<[string, number] | undefined>(
    (best, next) => (best === undefined || next[1] > best[1] ? next : best),
    undefined,
  )?.[0];
}

/** Return the id of the Library's artist each name, folded, is bound to by the Tracks writing it. */
function artistIdsOf(tracks: readonly Track[]): Map<string, string> {
  const ids = new Map<string, string>();
  for (const track of tracks) {
    track.artists.forEach((name, place) => {
      const id = track.artist_ids[place];
      if (id !== undefined) {
        ids.set(fold(name.trim()), id);
      }
    });
  }
  return ids;
}

/** Return the name the Library's artist `id` is written as by most of the Tracks bound to it. */
export function artistWrittenOf(tracks: readonly Track[], id: string): string | undefined {
  const written = new Map<string, number>();
  for (const track of tracks) {
    track.artist_ids.forEach((each, place) => {
      const name = track.artists[place];
      if (each === id && name !== undefined) {
        written.set(name, (written.get(name) ?? 0) + 1);
      }
    });
  }
  return [...written].reduce<[string, number] | undefined>(
    (best, next) => (best === undefined || next[1] > best[1] ? next : best),
    undefined,
  )?.[0];
}

/** Return the route to the page of the Track's artist at `place`, by the Library's artist it is. */
export function artistRouteOf(track: Track, place: number): Extract<Route, { view: "artist" }> {
  const name = artistNamesOf(track)[place] ?? "";
  const id = track.artist_ids[place];
  return id === undefined ? { view: "artist", name } : { view: "artist", name, id };
}

/**
 * Return the artists a Track counts under: each its artist names, if the name was split,
 * or else the name as written, blank for none.
 */
export function artistNamesOf(track: Track): readonly string[] {
  return track.artists.length > 0 ? track.artists : [track.artist];
}

export function artistProfileGroup(
  name: string,
  id: string | undefined,
  links: ArtistLinks | undefined,
): string {
  return links === undefined ? fold(name) : links.groupOfBound(name, id);
}

export function wholeArtistCredit(track: Track, names: readonly string[]): string | undefined {
  const written = fold(track.artist.trim());
  return names.some((name) => fold(name.trim()) === written) ? undefined : track.artist;
}

/**
 * Return the Tracks of the artist `name`, compared folded, in the order given: those
 * naming it as one of their artists, or as their whole artist as written. With `id`,
 * another artist called `name` than the name's first has only the Tracks bound to it,
 * and the first only those that aren't.
 */
export function tracksOfArtist(
  tracks: readonly Track[],
  name: string,
  links?: ArtistLinks,
  id?: string,
): Track[] {
  const key = artistProfileGroup(name, id, links);
  return tracks.filter((track) => {
    const names = artistNamesOf(track);
    const whole = wholeArtistCredit(track, names);
    return (
      names.some(
        (each, place) => artistProfileGroup(each, track.artist_ids[place], links) === key,
      ) ||
      (whole !== undefined && artistProfileGroup(whole, undefined, links) === key)
    );
  });
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

/** The four album covers shown on an artist's page in place of a photo. */
export function artistMosaic(songs: readonly Track[]): string[] {
  return albumsOf(songs)
    .flatMap((album) => (album.cover === null ? [] : [album.cover]))
    .slice(0, 4);
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
 * Where a cover chosen for one song is kept, so its album shows one cover: on the
 * split file the song comes from (`file`), whose songs all take its cover, or on
 * every song of the song's album (`songs`). A song on no album, or a split file
 * itself, keeps the cover alone.
 */
export type CoverPlace =
  | { readonly kind: "file"; readonly id: number }
  | { readonly kind: "songs"; readonly ids: readonly number[] };

export class CoverScopeError extends Error {
  constructor(
    readonly reason:
      | "This track is no longer in the Library."
      | "The cover target changed. Review the updated scope and try again."
      | "The image was uploaded to one track, but it was not applied to the rest of the album. Review the updated scope before trying again.",
  ) {
    super(reason);
  }
}

export function sameCoverPlace(shown: CoverPlace, current: CoverPlace): boolean {
  if (shown.kind === "file") return current.kind === "file" && shown.id === current.id;
  if (current.kind === "file" || shown.ids.length !== current.ids.length) return false;
  const ids = new Set(current.ids);
  return shown.ids.every((id) => ids.has(id));
}

/** Return where a cover chosen for `track`, one of `tracks`, is kept. */
export function coverPlaceOf(track: Track, tracks: readonly Track[]): CoverPlace {
  if (track.segment_of !== null) {
    return { kind: "file", id: track.segment_of };
  }
  if (track.split || track.album === "") {
    return { kind: "songs", ids: [track.id] };
  }
  const album = tracksOfAlbum(tracks, albumArtistOf(track), track.album).map(({ id }) => id);
  return { kind: "songs", ids: album.includes(track.id) ? album : [track.id, ...album] };
}

/**
 * Return the year an album came out, as most of its `songs` give it, the earlier year when
 * two are given as often; `null` when none of them gives a year.
 */
export function albumYearOf(songs: readonly Track[]): number | null {
  const counts = new Map<number, number>();
  for (const { year } of songs) {
    if (year !== null) {
      counts.set(year, (counts.get(year) ?? 0) + 1);
    }
  }
  let found: number | null = null;
  for (const [year, count] of counts) {
    const most = found === null ? 0 : (counts.get(found) ?? 0);
    if (found === null || count > most || (count === most && year < found)) {
      found = year;
    }
  }
  return found;
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
 * Return the Tracks with a saved Download or a failure that has not been dismissed.
 */
export function downloadedOf(tracks: readonly Track[]): Track[] {
  return tracks.filter((track) => track.downloaded || track.download_failure_job_id !== null);
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
 * `groups` limits which results are computed, intersecting with `kind:`.
 */
export function search(
  tracks: readonly Track[],
  query: string,
  links?: ArtistLinks,
  groups?: readonly (keyof Found)[],
): Found {
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
  const shows = (kind: keyof Found) =>
    (groups === undefined || groups.includes(kind)) && (kinds.size === 0 || kinds.has(kind));
  if (kept.length === tracks.length && folded === "") {
    // Only tags that keep every Track, such as kind:albums, list them all.
    return {
      tracks: shows("tracks") ? kept : [],
      artists: shows("artists") ? artistsOf(tracks, links) : [],
      albums: shows("albums") ? albumsOf(tracks) : [],
    };
  }
  // An artist or album is listed whole, with all its songs, when a song the tags keep is its.
  return {
    tracks: shows("tracks") ? ranked(kept, folded, haystackOf) : [],
    artists: shows("artists") ? matchingArtists(tracks, kept, asked, folded, links) : [],
    albums: shows("albums") ? matchingAlbums(tracks, kept, folded) : [],
  };
}

function matchingArtists(
  tracks: readonly Track[],
  kept: readonly Track[],
  asked: readonly Tag[],
  folded: string,
  links?: ArtistLinks,
): Artist[] {
  const keptArtists = new Set(
    kept.flatMap((track) => artistNamesOf(track).map((name) => artistKeyOf(name, links))),
  );
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
  return ranked(artists, folded, (artist) => namesOf(artist.link, links));
}

function matchingAlbums(tracks: readonly Track[], kept: readonly Track[], folded: string): Album[] {
  const keptAlbums = new Set(kept.map(albumKeyOf));
  return ranked(
    albumsOf(tracks).filter((album) => keptAlbums.has(albumKeyOf(album))),
    folded,
    (album) => fold(album.name),
  );
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
