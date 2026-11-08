import { describe, expect, it } from "vitest";

import type { Track } from "../api";
import { trackOf } from "../testing/server";
import { favoriteGroupsOf } from "./favoriteGroups";
import {
  albumShelves,
  canSuggest,
  likeness,
  nextPicks,
  seeded,
  stationSeed,
  tasteOf,
} from "./radio";

const NOW = new Date("2026-11-06T12:00:00Z");

/** The first of `tracks`, which a test names because it is there. */
function firstOf(tracks: readonly Track[]): Track {
  const [first] = tracks;
  if (first === undefined) {
    throw new Error("The test's Library is empty.");
  }
  return first;
}
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

/** A song of `album` by `artist`; every other field as `trackOf` gives it unless changed. */
const song = (id: number, artist: string, album: string, change: Partial<Track> = {}) =>
  trackOf(id, `Song ${String(id)}`, { artist, album, added_at: daysAgo(200), ...change });

describe("taste", () => {
  it("reads a favorite, a rating, and plays, with no rating as neutral", () => {
    expect(tasteOf(trackOf(1, "a"))).toBe(0);
    expect(tasteOf(trackOf(1, "a", { favorite: true }))).toBe(1);
    expect(tasteOf(trackOf(1, "a", { rating: 5 }))).toBe(1);
    expect(tasteOf(trackOf(1, "a", { rating: 1 }))).toBe(-1);
    expect(tasteOf(trackOf(1, "a", { play_count: 9 }))).toBeCloseTo(Math.log(10) / 4);
  });

  it("reads a song you haven't rated by your rating of its album, and yours first", () => {
    expect(tasteOf(trackOf(1, "a", { album_rating: 5 }))).toBe(1);
    expect(tasteOf(trackOf(1, "a", { rating: 1, album_rating: 5 }))).toBe(-1);
  });

  it("likes a song by a favorite artist or from a favorite album a half more, once", () => {
    const favorites = favoriteGroupsOf({
      artists: [{ name: "朴树" }],
      albums: [{ artist: "朴树", name: "生如夏花" }],
    });

    const byArtist = tasteOf(song(1, "朴树", "我去2000年"), favorites);
    const onAlbumByArtist = tasteOf(song(2, "朴树", "生如夏花"), favorites);
    const byAlbumArtist = tasteOf(
      song(3, "Guest", "生如夏花", { album_artist: "朴树" }),
      favorites,
    );
    const other = tasteOf(song(4, "许巍", "时光·漫步"), favorites);

    expect([byArtist, onAlbumByArtist, byAlbumArtist, other]).toEqual([0.5, 0.5, 0.5, 0]);
  });
});

describe("which songs are suggested", () => {
  it("suggests a song that plays now", () => {
    expect(canSuggest(trackOf(1, "a"))).toBe(true);
  });

  it.each<[string, Partial<Track>]>([
    ["one that can't play", { availability: "missing" }],
    ["a site song not downloaded", { site: "bilibili", downloaded: false }],
    ["a file split into songs", { split: true }],
    ["a whole album in one file", { kind: "album", duration_ms: 3_600_000 }],
    ["a song rated 2 stars", { rating: 2 }],
    ["a song of an album rated 2 stars", { album_rating: 2 }],
  ])("never suggests %s", (_, change) => {
    expect(canSuggest(trackOf(1, "a", change))).toBe(false);
  });

  it("suggests a downloaded site song and a song of a split file", () => {
    expect(canSuggest(trackOf(1, "a", { site: "bilibili", downloaded: true }))).toBe(true);
    expect(canSuggest(trackOf(2, "b", { segment_of: 1, duration_ms: 240_000 }))).toBe(true);
  });
});

describe("likeness", () => {
  it("counts the same artist, album, album artist, and genre, and years at most 5 apart", () => {
    const seed = song(1, "朴树", "生如夏花", { genre: "pop; rock", year: 2003 });

    expect(likeness(seed, song(2, "朴树", "生如夏花", { genre: "rock", year: 2003 }))).toBe(
      3 + 2 + 1 + 2 + 1,
    );
    expect(likeness(seed, song(3, "Radiohead", "OK Computer", { year: 2001 }))).toBeCloseTo(
      Math.exp(-2 / 5),
    );
    expect(likeness(seed, song(4, "Radiohead", "OK Computer", { year: 1997 }))).toBe(0);
  });

  it("matches folded text, and never an empty value or Various Artists", () => {
    const untagged = song(1, "", "");
    const compilation = song(2, "A", "Hits", { album_artist: "Various Artists" });

    // With no album artist, the artist stands in for it: the same artist, and album artist.
    expect(likeness(song(3, "RADIOHEAD", "x"), song(4, "radiohead", "y"))).toBe(3 + 1);
    expect(likeness(untagged, song(5, "", ""))).toBe(0);
    expect(likeness(compilation, song(6, "B", "Other", { album_artist: "Various Artists" }))).toBe(
      0,
    );
  });
});

/**
 * A Library to radio from:
 *
 * ```text
 * 1–4   朴树       生如夏花      pop
 * 5–8   Radiohead  OK Computer   alternative rock
 * 9     周杰伦      (none)        pop
 * 10    朴树       生如夏花      pop, rated 1 star
 * ```
 */
const LIBRARY = [
  ...[1, 2, 3, 4].map((id) => song(id, "朴树", "生如夏花", { genre: "pop", year: 2003 })),
  ...[5, 6, 7, 8].map((id) =>
    song(id, "Radiohead", "OK Computer", { genre: "alternative rock", year: 1997 }),
  ),
  song(9, "周杰伦", "", { genre: "pop", year: 2005 }),
  song(10, "朴树", "生如夏花", { genre: "pop", rating: 1 }),
];

describe("a radio", () => {
  const seed = firstOf(LIBRARY);

  it("picks songs like the seed, never the seed, a disliked song, or one played already", () => {
    const picks = nextPicks(LIBRARY, seed, [2], 3, seeded(1), NOW);

    const ids = picks.map((pick) => pick.track.id);
    expect(ids).not.toContain(1);
    expect(ids).not.toContain(2);
    expect(ids).not.toContain(10);
    expect(ids.every((id) => [3, 4, 9].includes(id))).toBe(true);
  });

  it("never picks a song with nothing in common with the seed", () => {
    const picks = nextPicks(LIBRARY, seed, [], 10, seeded(2), NOW);

    expect(picks.map((pick) => pick.track.id).some((id) => id >= 5 && id <= 8)).toBe(false);
  });

  it("says why each song is there, from its largest likeness", () => {
    const [first] = nextPicks([seed, song(2, "朴树", "Other")], seed, [], 1, seeded(3), NOW);

    expect(first?.reason).toBe("Same artist");
  });

  it("gives the same picks for the same generator, and never one song twice", () => {
    for (let run = 0; run < 20; run += 1) {
      const picks = nextPicks(LIBRARY, seed, [], 6, seeded(run), NOW).map((pick) => pick.track.id);

      expect(
        nextPicks(LIBRARY, seed, [], 6, seeded(run), NOW).map((pick) => pick.track.id),
      ).toEqual(picks);
      expect(new Set(picks).size).toBe(picks.length);
    }
  });

  it("plays at most two songs by one artist in a row while others remain", () => {
    const many = [
      ...Array.from({ length: 6 }, (_, i) => song(i + 1, "A", `A${String(i)}`, { genre: "pop" })),
      ...Array.from({ length: 6 }, (_, i) => song(i + 11, "B", `B${String(i)}`, { genre: "pop" })),
    ];

    for (let run = 0; run < 20; run += 1) {
      const artists = nextPicks(many, firstOf(many), [], 8, seeded(run), NOW).map(
        (pick) => pick.track.artist,
      );
      const threeInARow = artists.some(
        (artist, i) => i >= 2 && artist === artists[i - 1] && artist === artists[i - 2],
      );
      expect(threeInARow).toBe(false);
    }
  });

  it("picks a song played in the last two hours less often", () => {
    const fresh = [
      seed,
      song(2, "朴树", "生如夏花", { last_played_at: daysAgo(0.01) }),
      song(3, "朴树", "生如夏花"),
    ];

    const firsts = Array.from(
      { length: 40 },
      (_, run) => nextPicks(fresh, seed, [], 1, seeded(run), NOW)[0]?.track.id,
    );

    const count = (id: number) => firsts.filter((each) => each === id).length;
    expect(count(3)).toBeGreaterThan(count(2));
  });

  it("ends when no song is like the seed", () => {
    expect(nextPicks([seed, song(2, "X", "Y")], seed, [], 5, seeded(4), NOW)).toEqual([]);
  });
});

describe("my station", () => {
  it("starts from one of the songs the Account likes best", () => {
    const liked = [
      song(1, "A", "a", { favorite: true }),
      song(2, "B", "b", { play_count: 30 }),
      song(3, "C", "c"),
    ];

    for (let run = 0; run < 20; run += 1) {
      expect([1, 2]).toContain(stationSeed(liked, seeded(run))?.id);
    }
  });

  it("starts from a favorite artist's song when no song is liked yet", () => {
    const songs = [song(1, "A", "a"), song(2, "朴树", "b"), song(3, "C", "c")];
    const favorites = favoriteGroupsOf({ artists: [{ name: "朴树" }], albums: [] });

    for (let run = 0; run < 20; run += 1) {
      expect(stationSeed(songs, seeded(run), favorites)?.id).toBe(2);
    }
  });

  it("starts from any song that plays when nothing is liked yet", () => {
    expect(stationSeed([song(1, "A", "a")], seeded(1))?.id).toBe(1);
    expect(stationSeed([], seeded(1))).toBeUndefined();
  });
});

describe("the album shelves", () => {
  const shelf = (tracks: readonly Track[], id: string) =>
    albumShelves(tracks, NOW, seeded(1)).find((each) => each.id === id);
  const names = (tracks: readonly Track[], id: string) =>
    shelf(tracks, id)?.albums.map((album) => album.name);

  it("suggests more albums like the one played most lately", () => {
    const library = [
      song(1, "朴树", "生如夏花", { genre: "pop", play_count: 12, last_played_at: daysAgo(2) }),
      song(2, "朴树", "生如夏花", { genre: "pop", play_count: 8, last_played_at: daysAgo(3) }),
      song(3, "朴树", "我去2000年", { genre: "pop" }),
      song(4, "朴树", "我去2000年", { genre: "pop" }),
      song(5, "Radiohead", "OK Computer", { genre: "rock" }),
      song(6, "Radiohead", "OK Computer", { genre: "rock" }),
    ];

    const like = shelf(library, "more-like");

    expect(like?.title).toBe("More like 生如夏花");
    expect(like?.albums.map((album) => album.name)).toEqual(["我去2000年"]);
    expect(like?.albums[0]?.reason).toBe("Like 生如夏花");
  });

  it("suggests unplayed albums by an artist the Account plays", () => {
    const library = [
      song(1, "朴树", "生如夏花", { play_count: 5, last_played_at: daysAgo(100) }),
      song(2, "朴树", "生如夏花", { play_count: 3, last_played_at: daysAgo(100) }),
      song(3, "朴树", "猎户星座"),
      song(4, "朴树", "猎户星座"),
      song(5, "Nobody", "Unknown"),
      song(6, "Nobody", "Unknown"),
    ];

    expect(names(library, "not-played")).toEqual(["猎户星座"]);
    expect(shelf(library, "not-played")?.albums[0]?.reason).toBe("New to you, from 朴树");
  });

  it("brings back a loved album not played in two months", () => {
    const library = [
      song(1, "A", "Loved", { favorite: true, play_count: 4, last_played_at: daysAgo(120) }),
      song(2, "A", "Loved", { rating: 5, play_count: 4, last_played_at: daysAgo(120) }),
      song(3, "B", "Recent", { favorite: true, play_count: 4, last_played_at: daysAgo(5) }),
      song(4, "B", "Recent", { favorite: true, play_count: 4, last_played_at: daysAgo(5) }),
    ];

    expect(names(library, "rediscover")).toEqual(["Loved"]);
    expect(shelf(library, "rediscover")?.albums[0]?.reason).toMatch(/^Not played since /u);
  });

  it("shows albums added lately, newest first, until every song was played", () => {
    const library = [
      song(1, "A", "Older", { added_at: daysAgo(20) }),
      song(2, "A", "Older", { added_at: daysAgo(20) }),
      song(3, "B", "Newest", { added_at: daysAgo(0) }),
      song(4, "B", "Newest", { added_at: daysAgo(0) }),
      song(5, "C", "Heard", { added_at: daysAgo(1), play_count: 1 }),
      song(6, "C", "Heard", { added_at: daysAgo(1), play_count: 1 }),
    ];

    expect(names(library, "just-added")).toEqual(["Newest", "Older"]);
    expect(shelf(library, "just-added")?.albums[0]?.reason).toBe("Added today");
  });

  it("never suggests a single, an album of songs that can't play, or a disliked album", () => {
    const library = [
      song(1, "A", "Single", { added_at: daysAgo(1) }),
      song(2, "B", "Gone", { added_at: daysAgo(1), availability: "missing" }),
      song(3, "B", "Gone", { added_at: daysAgo(1), availability: "missing" }),
      song(4, "C", "Disliked", { added_at: daysAgo(1), rating: 1 }),
      song(5, "C", "Disliked", { added_at: daysAgo(1), rating: 2 }),
    ];

    expect(albumShelves(library, NOW, seeded(1))).toEqual([]);
  });

  it("never suggests an album you rated low, songs unrated", () => {
    const library = [
      song(1, "C", "Disliked", { added_at: daysAgo(1), album_rating: 1 }),
      song(2, "C", "Disliked", { added_at: daysAgo(1), album_rating: 1 }),
    ];

    expect(albumShelves(library, NOW, seeded(1))).toEqual([]);
  });

  it("puts each album on one shelf only, and at most two by one artist on a shelf", () => {
    const library = Array.from({ length: 5 }, (_, album) =>
      [1, 2].map((n) =>
        song(album * 10 + n, "A", `Album ${String(album)}`, { added_at: daysAgo(1) }),
      ),
    ).flat();

    const shelves = albumShelves(library, NOW, seeded(1));
    const all = shelves.flatMap((each) => each.albums.map((album) => album.key));

    expect(new Set(all).size).toBe(all.length);
    expect(shelves.every((each) => each.albums.length <= 2)).toBe(true);
  });

  it("offers the Library's newest albums when the Account has played nothing", () => {
    const library = [
      song(1, "A", "First", { added_at: daysAgo(300) }),
      song(2, "A", "First", { added_at: daysAgo(300) }),
      song(3, "B", "Second", { added_at: daysAgo(90) }),
      song(4, "B", "Second", { added_at: daysAgo(90) }),
    ];

    expect(names(library, "library")).toEqual(["Second", "First"]);
  });
});

describe("what the review asked of albums and stations", () => {
  it("makes the songs of one split file one album, whatever artist each names", () => {
    const library = [
      song(1, "朴树", "生如夏花", { split: true, duration_ms: 49 * 60_000, added_at: daysAgo(2) }),
      song(2, "朴树", "生如夏花", { segment_of: 1, added_at: daysAgo(2) }),
      song(3, "朴树 & 合唱团", "生如夏花", { segment_of: 1, added_at: daysAgo(2) }),
    ];

    const [shelf] = albumShelves(library, NOW, seeded(1));

    expect(shelf?.albums.map((album) => album.tracks.map((track) => track.id))).toEqual([[2, 3]]);
  });

  it("finds nothing like a song that shares only a year", () => {
    const seed = song(1, "A", "a", { year: 2003 });

    expect(
      nextPicks([seed, song(2, "B", "b", { year: 2003 })], seed, [], 3, seeded(1), NOW),
    ).toEqual([]);
  });

  it("starts a station from songs of several albums, never from an untitled video", () => {
    const library = [
      ...[1, 2, 3, 4, 5].map((id) => song(id, "A", "One", { favorite: true, play_count: 50 })),
      song(6, "B", "Two", { favorite: true }),
      trackOf(7, "BV1AC4y1L7Yi", { favorite: true, play_count: 99 }),
    ];

    const seeds = new Set(
      Array.from({ length: 60 }, (_, run) => stationSeed(library, seeded(run))?.id),
    );

    expect(seeds.has(7)).toBe(false);
    expect(seeds.has(6)).toBe(true);
    expect([...seeds].filter((id) => id !== undefined && id <= 5).length).toBeLessThanOrEqual(2);
  });

  it("shelves a Library of 20,000 songs quickly", () => {
    const library = Array.from({ length: 20_000 }, (_, i) =>
      song(i + 1, `Artist ${String(i % 400)}`, `Album ${String(i % 2000)}`, {
        genre: i % 3 === 0 ? "pop" : "rock",
        play_count: i % 7,
        last_played_at: i % 7 === 0 ? null : daysAgo(i % 90),
        added_at: daysAgo(i % 120),
      }),
    );

    const started = performance.now();
    albumShelves(library, NOW, seeded(1));
    nextPicks(library, firstOf(library), [], 10, seeded(1), NOW);

    // About 150 ms on the household's machine; the bound catches a slip into quadratic
    // work, tens of seconds here, without failing when the machine is busy.
    expect(performance.now() - started).toBeLessThan(5_000);
  });
});

describe("albums no one described yet", () => {
  it("never suggests an album named for a video's id", () => {
    const library = [1, 2].map((id) => song(id, "", "BV1dm4y1s7ak", { added_at: daysAgo(1) }));

    expect(albumShelves(library, NOW, seeded(1))).toEqual([]);
  });

  it("names a split file's songs for the file when they name no album", () => {
    const library = [
      trackOf(1, "生如夏花 album video", { split: true, added_at: daysAgo(1) }),
      song(2, "朴树", "", { segment_of: 1, added_at: daysAgo(1) }),
      song(3, "朴树", "", { segment_of: 1, added_at: daysAgo(1) }),
    ];

    const [shelf] = albumShelves(library, NOW, seeded(1));

    expect(shelf?.albums.map((album) => album.name)).toEqual(["生如夏花 album video"]);
  });
});
