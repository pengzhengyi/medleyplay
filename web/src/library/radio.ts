/**
 * @file What to play next from the Account's own Library: a radio from a song, the
 * Account's own station, and shelves of albums.
 *
 * Pure functions of the Tracks the client already holds, the time, and a generator,
 * so the same generator gives the same picks. Scoring is a small sum that says why:
 *
 * ```text
 * likeness = 3·same artist + 2·same album + 1·same album artist
 *          + 2·shared genre + exp(−|year difference| / 5) when at most 5 years apart
 * taste    = favorite + (rating − 3) / 2 + log(1 + plays) / 4      (no rating counts as 3)
 * ```
 */

import type { Track } from "../api";
import { albumArtistOf, fold } from "./views";

/** A number from 0 up to 1, as `Math.random` gives. */
export type Random = () => number;

/** Return a generator of numbers from `seed`, the same numbers for the same seed. */
export function seeded(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Return a seed from `text`, such as an Account and a date. */
export function seedOf(text: string): number {
  let hash = 0x811c9dc5;
  for (const character of text) {
    hash = Math.imul(hash ^ (character.codePointAt(0) ?? 0), 0x01000193);
  }
  return hash >>> 0;
}

const LONGEST_SONG_MS = 20 * 60_000;
/** A title that is a Bilibili video's id, as a Track not yet described has. */
const UNNAMED = /^BV[0-9A-Za-z]{10}$/u;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** How much the Account likes the song: 0 for no word either way. */
export function tasteOf(track: Track): number {
  return (
    (track.favorite ? 1 : 0) + ((track.rating ?? 3) - 3) / 2 + Math.log1p(track.play_count) / 4
  );
}

/**
 * Whether a song may be suggested: it plays now, from a file or a Download, is a
 * song rather than an album file, and isn't rated 1–2.
 */
export function canSuggest(track: Track): boolean {
  return (
    track.availability === "ok" &&
    (track.site === null || track.downloaded) &&
    !track.split &&
    (track.segment_of !== null || (track.duration_ms ?? 0) <= LONGEST_SONG_MS) &&
    (track.rating === null || track.rating >= 3)
  );
}

// A Library repeats a few names many times, and folding is the costly part of a match.
const folds = new Map<string, string>();
const keys = new Map<string, string | undefined>();

/** `text` folded as the Albums view folds it, remembered. */
const folded = (text: string): string => {
  let found = folds.get(text);
  if (found === undefined) {
    found = fold(text);
    folds.set(text, found);
  }
  return found;
};
const genreSets = new Map<string, Set<string>>();

/** A value to compare, folded; empty, or Various Artists, matches nothing. */
const keyOf = (text: string): string | undefined => {
  if (!keys.has(text)) {
    const key = folded(text.trim());
    keys.set(text, key === "" || key === "various artists" ? undefined : key);
  }
  return keys.get(text);
};

/** A genre such as `alternative rock; britpop` is each of its parts, folded. */
const genresOf = (genre: string): Set<string> => {
  let found = genreSets.get(genre);
  if (found === undefined) {
    found = new Set(
      genre
        .split(/[;,/、]/u)
        .map((part) => folded(part.trim()))
        .filter((part) => part !== ""),
    );
    genreSets.set(genre, found);
  }
  return found;
};

const same = (a: string, b: string) => {
  const key = keyOf(a);
  return key !== undefined && key === keyOf(b);
};

const sharesGenre = (a: Track, b: Track) => {
  const theirs = genresOf(b.genre);
  return [...genresOf(a.genre)].some((genre) => theirs.has(genre));
};

const closeYears = (a: number | null, b: number | null) =>
  a !== null && b !== null && Math.abs(a - b) <= 5 ? Math.exp(-Math.abs(a - b) / 5) : 0;

type Term = "artist" | "album" | "album artist" | "genre" | "year";

function terms(a: Track, b: Track): [Term, number][] {
  return [
    ["artist", same(a.artist, b.artist) ? 3 : 0],
    ["album", same(a.album, b.album) && same(albumArtistOf(a), albumArtistOf(b)) ? 2 : 0],
    ["album artist", same(albumArtistOf(a), albumArtistOf(b)) ? 1 : 0],
    ["genre", sharesGenre(a, b) ? 2 : 0],
    ["year", closeYears(a.year, b.year)],
  ];
}

/** How alike two songs are, from their shown details; 0 when nothing matches. */
export function likeness(a: Track, b: Track): number {
  return terms(a, b).reduce((sum, [, value]) => sum + value, 0);
}

const REASONS: Record<Term, string> = {
  artist: "Same artist",
  album: "Same album",
  "album artist": "Same album artist",
  genre: "Same genre",
  year: "From around the same time",
};

/** A song a radio picked, and why. */
export interface Pick {
  readonly track: Track;
  readonly reason: string;
}

/** How long ago the song was played lowers it: 2 within two hours, 1 within a day. */
function recency(track: Track, now: Date): number {
  if (track.last_played_at === null) {
    return 0;
  }
  const since = now.getTime() - Date.parse(track.last_played_at);
  return since < 2 * HOUR_MS ? 2 : since < DAY_MS ? 1 : 0;
}

const TOP = 30;

/** Draw one of `scored` weighted by its score; `scored` is not empty. */
function draw<T>(scored: readonly { item: T; score: number }[], random: Random): T {
  const total = scored.reduce((sum, each) => sum + each.score, 0);
  let left = random() * total;
  for (const each of scored) {
    left -= each.score;
    if (left < 0) {
      return each.item;
    }
  }
  return (scored.at(-1) as { item: T }).item;
}

/**
 * The next `count` songs of a radio from `seed`, after the songs in `played`.
 *
 * Each pick is drawn from the 30 best candidates weighted by score: a candidate is
 * like the seed, and taste only breaks ties, worth less than one matching field.
 * At most two songs in a row by one artist and three from one album, until too few
 * songs remain, when the album rule goes first, then the artist rule. Fewer than
 * `count` come back when the radio runs out.
 */
export function nextPicks(
  tracks: readonly Track[],
  seed: Track,
  played: readonly number[],
  count: number,
  random: Random,
  now: Date,
): Pick[] {
  const byId = new Map(tracks.map((track) => [track.id, track]));
  const history = [seed, ...played.flatMap((id) => byId.get(id) ?? [])];
  const used = new Set([seed.id, ...played]);
  const candidates = tracks.flatMap((track) => {
    if (used.has(track.id) || !canSuggest(track)) {
      return [];
    }
    const parts = terms(seed, track);
    // A close year only adds to a match: an artist, album, or genre must match.
    if (!parts.some(([term, value]) => term !== "year" && value > 0)) {
      return [];
    }
    const like = parts.reduce((sum, [, value]) => sum + value, 0);
    const taste = Math.max(-0.9, Math.min(0.9, tasteOf(track) / 3));
    const score = Math.max(0.05, like + taste - recency(track, now));
    const [largest] = [...parts].sort((a, b) => b[1] - a[1]);
    const reason =
      track.favorite && taste > 0 && largest?.[0] === "year"
        ? "A favorite"
        : REASONS[largest?.[0] ?? "year"];
    return [{ track, score, reason }];
  });
  // Best first, once; each pick walks the list, so a long Library is sorted only once.
  candidates.sort((a, b) => b.score - a.score);
  const artistOf = (track: Track) => keyOf(track.artist);
  const albumOf = (track: Track) => {
    const album = keyOf(track.album);
    return album === undefined ? undefined : `${album}\n${keyOf(albumArtistOf(track)) ?? ""}`;
  };
  const sequence = [...history];
  const fromAlbum = new Map<string, number>();
  for (const track of sequence) {
    const album = albumOf(track);
    if (album !== undefined) {
      fromAlbum.set(album, (fromAlbum.get(album) ?? 0) + 1);
    }
  }
  const picks: Pick[] = [];
  while (picks.length < count) {
    const lastTwo = sequence.slice(-2).map(artistOf);
    const repeated =
      lastTwo.length === 2 && lastTwo[0] !== undefined && lastTwo[0] === lastTwo[1]
        ? lastTwo[0]
        : undefined;
    // The album rule gives way first, then the artist rule, only when nothing else is left.
    const strict: typeof candidates = [];
    const loose: typeof candidates = [];
    const left: typeof candidates = [];
    for (const each of candidates) {
      if (used.has(each.track.id)) {
        continue;
      }
      left.push(each);
      if (repeated !== undefined && artistOf(each.track) === repeated) {
        continue;
      }
      loose.push(each);
      const album = albumOf(each.track);
      if (album === undefined || (fromAlbum.get(album) ?? 0) < 3) {
        strict.push(each);
        if (strict.length === TOP) {
          break;
        }
      }
    }
    const pool = (strict.length > 0 ? strict : loose.length > 0 ? loose : left).slice(0, TOP);
    if (pool.length === 0) {
      break;
    }
    const chosen = draw(
      pool.map((each) => ({ item: each, score: each.score })),
      random,
    );
    used.add(chosen.track.id);
    sequence.push(chosen.track);
    const album = albumOf(chosen.track);
    if (album !== undefined) {
      fromAlbum.set(album, (fromAlbum.get(album) ?? 0) + 1);
    }
    picks.push({ track: chosen.track, reason: chosen.reason });
  }
  return picks;
}

/** The song the Account's own station starts from: one of its 20 best liked, or any. */
export function stationSeed(tracks: readonly Track[], random: Random): Track | undefined {
  // A title that is still a video's id says nothing a radio could follow.
  const songs = tracks.filter((track) => canSuggest(track) && !UNNAMED.test(track.title));
  const perGroup = new Map<string, number>();
  const liked = songs
    .map((track) => ({ item: track, score: tasteOf(track) }))
    .filter((each) => each.score > 0)
    .sort((a, b) => b.score - a.score)
    .filter(({ item }) => {
      // At most 2 by one artist and 2 from one album, so the 20 aren't one album's.
      const keys = [
        `artist\n${folded(item.artist)}`,
        `album\n${albumKeyOf(item) ?? String(item.id)}`,
      ];
      if (keys.some((key) => (perGroup.get(key) ?? 0) >= 2)) {
        return false;
      }
      for (const key of keys) {
        perGroup.set(key, (perGroup.get(key) ?? 0) + 1);
      }
      return true;
    })
    .slice(0, 20);
  if (liked.length > 0) {
    return draw(liked, random);
  }
  return songs.length === 0 ? undefined : songs[Math.floor(random() * songs.length)];
}

/** An album to suggest: its songs that play now, and why it is on its shelf. */
export interface AlbumCard {
  /** The album artist and the name, folded: one album, as the Albums view groups it. */
  readonly key: string;
  readonly name: string;
  readonly artist: string;
  /** The album its songs name, which the Albums view opens; empty for a split file's songs that name none. */
  readonly album: string;
  readonly cover: string | null;
  readonly tracks: readonly Track[];
  readonly reason: string;
}

export type ShelfId = "more-like" | "not-played" | "rediscover" | "just-added" | "library";

/** A row of albums of one kind. */
export interface Shelf {
  readonly id: ShelfId;
  readonly title: string;
  readonly albums: readonly AlbumCard[];
}

interface Album {
  readonly key: string;
  readonly name: string;
  readonly album: string;
  readonly artist: string;
  readonly tracks: readonly Track[];
  readonly taste: number;
  readonly lastPlayed: number | undefined;
  readonly added: number;
  readonly plays: number;
  readonly anyPlayed: boolean;
  readonly allPlayed: boolean;
  readonly genres: Set<string>;
  readonly year: number | null;
}

/** An album is as liked as its 3 best-liked songs: a few favorites make it loved. */
const bestThree = (songs: readonly Track[]) => {
  const best = songs
    .map(tasteOf)
    .sort((a, b) => b - a)
    .slice(0, 3);
  return best.reduce((sum, taste) => sum + taste, 0) / best.length;
};

const PER_SHELF = 12;
const PER_ARTIST = 2;
const months = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });

/**
 * The album a song is on: the songs of one split file are one album, whatever their
 * tags; any other is its album artist and its name, folded, as the Albums view
 * groups them. A song with no album is on none.
 */
function albumKeyOf(track: Track): string | undefined {
  if (track.segment_of !== null) {
    return `file\n${String(track.segment_of)}`;
  }
  // An album named for a video's id is a video no one described yet, not an album.
  return track.album.trim() === "" || UNNAMED.test(track.album.trim())
    ? undefined
    : `${folded(albumArtistOf(track))}\n${folded(track.album)}`;
}

/**
 * What an album is called: its name, or for the songs of a split file with none, the
 * file's title; empty when neither says anything but a video's id.
 */
function nameOf(first: Track, files: ReadonlyMap<number, Track>): string {
  const named = (text: string) => (text.trim() === "" || UNNAMED.test(text.trim()) ? "" : text);
  const file = first.segment_of === null ? undefined : files.get(first.segment_of);
  return named(first.album) || named(file?.title ?? "");
}

/** Group the songs into albums of at least 2 songs that play now; none of a disliked album. */
function albumsOf(tracks: readonly Track[]): Album[] {
  const files = new Map(tracks.filter((track) => track.split).map((track) => [track.id, track]));
  const groups = new Map<string, Track[]>();
  for (const track of tracks) {
    const key = track.split ? undefined : albumKeyOf(track);
    if (key === undefined) {
      continue;
    }
    groups.set(key, [...(groups.get(key) ?? []), track]);
  }
  return [...groups].flatMap(([key, songs]) => {
    const rated = songs.filter((song) => song.rating !== null);
    const disliked = rated.filter((song) => (song.rating ?? 3) <= 2);
    const playable = songs.filter(canSuggest);
    if (playable.length < 2 || disliked.length * 2 > rated.length) {
      return [];
    }
    const [first] = songs;
    if (first === undefined || nameOf(first, files) === "") {
      return [];
    }
    const played = songs.flatMap((song) =>
      song.last_played_at === null ? [] : [Date.parse(song.last_played_at)],
    );
    const genres = new Set(songs.flatMap((song) => [...genresOf(song.genre)]));
    return [
      {
        key,
        name: nameOf(first, files),
        album: UNNAMED.test(first.album.trim()) ? "" : first.album,
        artist: albumArtistOf(first),
        tracks: playable,
        taste: bestThree(songs),
        lastPlayed: played.length === 0 ? undefined : Math.max(...played),
        added: Math.min(...songs.map((song) => Date.parse(song.added_at))),
        plays: songs.reduce((sum, song) => sum + song.play_count, 0),
        anyPlayed: songs.some((song) => song.play_count > 0),
        allPlayed: songs.every((song) => song.play_count > 0),
        genres,
        year: songs.find((song) => song.year !== null)?.year ?? null,
      },
    ];
  });
}

/** How much the Account likes each album artist and genre, from the songs it plays or likes. */
function affinities(tracks: readonly Track[], albums: readonly Album[]) {
  const artists = new Map<string, number>();
  const genres = new Map<string, number>();
  for (const track of tracks) {
    const taste = tasteOf(track);
    if (taste <= 0) {
      continue;
    }
    const artist = keyOf(albumArtistOf(track));
    if (artist !== undefined) {
      artists.set(artist, (artists.get(artist) ?? 0) + taste);
    }
    for (const genre of genresOf(track.genre)) {
      genres.set(genre, (genres.get(genre) ?? 0) + taste);
    }
  }
  // A log, so an artist with many songs does not crowd out every other.
  const damp = (values: Map<string, number>) =>
    new Map([...values].map(([key, value]) => [key, Math.log1p(value)]));
  // A genre most albums share says little: it counts as rarely as it is found.
  const holding = new Map<string, number>();
  for (const album of albums) {
    for (const genre of album.genres) {
      holding.set(genre, (holding.get(genre) ?? 0) + 1);
    }
  }
  const rare = (genre: string) => Math.log((1 + albums.length) / (1 + (holding.get(genre) ?? 0)));
  const damped = damp(genres);
  return {
    artists: damp(artists),
    genres: new Map([...damped].map(([genre, value]) => [genre, value * rare(genre)])),
  };
}

function albumLikeness(a: Album, b: Album): number {
  const artist = keyOf(a.artist) !== undefined && keyOf(a.artist) === keyOf(b.artist) ? 3 : 0;
  const genres = [...a.genres].filter((genre) => b.genres.has(genre)).length * 2;
  return artist + genres + closeYears(a.year, b.year);
}

const coverOf = (album: Album) => album.tracks.find((track) => track.cover !== null)?.cover ?? null;

function daysAgoText(days: number): string {
  if (days < 1) {
    return "Added today";
  }
  return days < 2 ? "Added yesterday" : `Added ${String(Math.floor(days))} days ago`;
}

/**
 * The Radio tab's shelves, in order: *More like …*, *Not played yet*, *Rediscover*,
 * *Just added*, and, for an Account that has played and liked nothing, the
 * Library's newest albums. Each album shows once, with at most 2 by one album artist
 * and 12 on a shelf; ties break by `random`. A shelf with no album is left out.
 */
export function albumShelves(tracks: readonly Track[], now: Date, random: Random): Shelf[] {
  const albums = albumsOf(tracks);
  // Ties break the same way for the same generator: a random order, kept stably.
  const order = new Map(albums.map((album) => [album.key, random()]));
  const { artists, genres } = affinities(tracks, albums);
  const taken = new Set<string>();
  const shelves: Shelf[] = [];
  const shelf = (
    id: ShelfId,
    title: string,
    ranked: readonly { album: Album; score: number; reason: string }[],
  ) => {
    const perArtist = new Map<string, number>();
    const cards: AlbumCard[] = [];
    for (const { album, reason } of [...ranked].sort(
      (a, b) => b.score - a.score || (order.get(a.album.key) ?? 0) - (order.get(b.album.key) ?? 0),
    )) {
      const artist = folded(album.artist);
      if (taken.has(album.key) || (perArtist.get(artist) ?? 0) >= PER_ARTIST) {
        continue;
      }
      perArtist.set(artist, (perArtist.get(artist) ?? 0) + 1);
      taken.add(album.key);
      cards.push({
        key: album.key,
        name: album.name,
        album: album.album,
        artist: album.artist,
        cover: coverOf(album),
        tracks: album.tracks,
        reason,
      });
      if (cards.length === PER_SHELF) {
        break;
      }
    }
    if (cards.length > 0) {
      shelves.push({ id, title, albums: cards });
    }
  };
  const time = now.getTime();

  const recent = albums
    .filter((album) => album.lastPlayed !== undefined && time - album.lastPlayed <= 30 * DAY_MS)
    .sort((a, b) => b.plays - a.plays);
  const anchor = recent[0];
  if (anchor !== undefined) {
    taken.add(anchor.key);
    shelf(
      "more-like",
      `More like ${anchor.name}`,
      albums.flatMap((album) => {
        const like = albumLikeness(anchor, album);
        return like > 0 ? [{ album, score: like, reason: `Like ${anchor.name}` }] : [];
      }),
    );
  }

  shelf(
    "not-played",
    "Not played yet",
    albums.flatMap((album) => {
      if (album.anyPlayed) {
        return [];
      }
      const artist = artists.get(keyOf(album.artist) ?? "") ?? 0;
      const genre = Math.max(0, ...[...album.genres].map((each) => genres.get(each) ?? 0));
      const score = artist + genre / 2;
      if (score <= 0) {
        return [];
      }
      const reason =
        artist > 0 ? `New to you, from ${album.artist}` : "New to you, in a genre you play";
      return [{ album, score, reason }];
    }),
  );

  shelf(
    "rediscover",
    "Rediscover",
    albums.flatMap((album) => {
      if (album.lastPlayed === undefined || album.taste < 0.75) {
        return [];
      }
      const since = (time - album.lastPlayed) / DAY_MS;
      if (since < 60) {
        return [];
      }
      // Up to a year away counts: a loved album gone two years is no likelier than one.
      const score = album.taste * Math.min(since / 30, 12);
      const reason = `Not played since ${months.format(album.lastPlayed)}`;
      return [{ album, score, reason }];
    }),
  );

  shelf(
    "just-added",
    "Just added",
    albums.flatMap((album) => {
      const since = (time - album.added) / DAY_MS;
      return since <= 30 && !album.allPlayed
        ? [{ album, score: -since, reason: daysAgoText(since) }]
        : [];
    }),
  );

  const anything = tracks.some((track) => track.play_count > 0 || tasteOf(track) > 0);
  if (!anything) {
    shelf(
      "library",
      "From your Library",
      albums.map((album) => ({
        album,
        score: album.added,
        reason: daysAgoText((time - album.added) / DAY_MS),
      })),
    );
  }
  return shelves;
}
