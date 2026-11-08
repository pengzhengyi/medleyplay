import { describe, expect, it } from "vitest";

import type { Track } from "../api";
import { trackOf } from "../testing/server";
import { allTimePlays, insightsOf } from "./insights";

const MINUTE = 60_000;

/** A song of `album` by `artist`, `minutes` long; every other field as `trackOf` gives it. */
const song = (
  id: number,
  artist: string,
  album: string,
  minutes: number,
  change: Partial<Track> = {},
) => trackOf(id, `Song ${String(id)}`, { artist, album, duration_ms: minutes * MINUTE, ...change });

/** How often each Track was played, as `[id, plays]` pairs. */
const played = (...pairs: [number, number][]) => new Map(pairs);

describe("insightsOf", () => {
  it("counts a song's listening time as its plays times its length, summed for each artist", () => {
    const tracks = [
      song(1, "朴树", "生如夏花", 4),
      song(2, "朴树", "生如夏花", 5),
      song(3, "Ado", "狂言", 3),
    ];

    const insights = insightsOf(tracks, played([1, 2], [2, 1], [3, 10]));

    expect(insights).toMatchObject({
      plays: 13,
      listenedMs: 43 * MINUTE,
      songs: 3,
      playsNotTimed: 0,
    });
    expect(
      insights.artists.map(({ name, plays, listenedMs }) => [name, plays, listenedMs]),
    ).toEqual([
      ["Ado", 10, 30 * MINUTE],
      ["朴树", 3, 13 * MINUTE],
    ]);
  });

  it("groups an artist and an album however their names are written, as the Library does", () => {
    const tracks = [song(1, "ヨルシカ", "盗作", 4), song(2, "よるしか", "盗作", 4)];

    const insights = insightsOf(tracks, played([1, 1], [2, 1]));

    expect(insights.artists).toHaveLength(1);
    expect(insights.artists[0]).toMatchObject({ name: "ヨルシカ", plays: 2 });
    expect(insights.albums).toHaveLength(1);
  });

  it("lists an album under its album artist, or its artist when that is blank", () => {
    const tracks = [
      song(1, "Guest", "Hits", 4, { album_artist: "Various" }),
      song(2, "Other", "Hits", 4, { album_artist: "Various" }),
      song(3, "Solo", "Hits", 4),
    ];

    const insights = insightsOf(tracks, played([1, 1], [2, 1], [3, 1]));

    expect(insights.albums.map(({ artist, name, plays }) => [artist, name, plays])).toEqual([
      ["Various", "Hits", 2],
      ["Solo", "Hits", 1],
    ]);
  });

  it("ranks by listening time, then by plays when the time is the same", () => {
    const tracks = [song(1, "Short", "A", 2), song(2, "Long", "B", 4), song(3, "Few", "C", 8)];

    const insights = insightsOf(tracks, played([1, 4], [2, 2], [3, 1]));

    expect(insights.artists.map(({ name }) => name)).toEqual(["Short", "Long", "Few"]);
  });

  it("counts the plays of a whole-album file but not its length, and never as a top song", () => {
    const tracks = [
      song(1, "朴树", "生如夏花", 60, { kind: "album" }),
      song(2, "朴树", "生如夏花", 4),
    ];

    const insights = insightsOf(tracks, played([1, 3], [2, 1]));

    expect(insights).toMatchObject({
      plays: 4,
      listenedMs: 4 * MINUTE,
      playsNotTimed: 3,
      songs: 1,
    });
    expect(insights.albums[0]).toMatchObject({ plays: 4, listenedMs: 4 * MINUTE });
    expect(insights.topSongs.map(({ track }) => track.id)).toEqual([2]);
  });

  it("counts the plays of a song of unknown length but not its time", () => {
    const tracks = [song(1, "Ado", "狂言", 0, { duration_ms: null })];

    const insights = insightsOf(tracks, played([1, 2]));

    expect(insights).toMatchObject({ plays: 2, listenedMs: 0, playsNotTimed: 2 });
    expect(insights.artists[0]).toMatchObject({ plays: 2, listenedMs: 0 });
  });

  it("leaves a blank artist and a blank album out of the rankings but in the totals", () => {
    const tracks = [song(1, "", "", 4), song(2, "Ado", "", 4)];

    const insights = insightsOf(tracks, played([1, 5], [2, 1]));

    expect(insights.listenedMs).toBe(24 * MINUTE);
    expect(insights.artists.map(({ name }) => name)).toEqual(["Ado"]);
    expect(insights.albums).toEqual([]);
  });

  it("ranks the top songs by plays, then by listening time, leaving out those not played", () => {
    const tracks = [song(1, "A", "X", 3), song(2, "B", "Y", 5), song(3, "C", "Z", 4)];

    const insights = insightsOf(tracks, played([1, 2], [2, 2], [3, 0]));

    expect(insights.topSongs.map(({ track, plays }) => [track.id, plays])).toEqual([
      [2, 2],
      [1, 2],
    ]);
  });

  it("finds nothing when nothing was played", () => {
    const insights = insightsOf([song(1, "Ado", "狂言", 3)], played());

    expect(insights).toEqual({
      plays: 0,
      listenedMs: 0,
      playsNotTimed: 0,
      songs: 0,
      artists: [],
      albums: [],
      topSongs: [],
    });
  });
});

describe("allTimePlays", () => {
  it("takes each played Track's own play count", () => {
    const tracks = [song(1, "Ado", "狂言", 3, { play_count: 4 }), song(2, "Ado", "狂言", 3)];

    expect(allTimePlays(tracks)).toEqual(played([1, 4]));
  });
});
