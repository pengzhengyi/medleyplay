import { describe, expect, it } from "vitest";

import type { Track } from "../api";
import { trackOf } from "../testing/server";
import { playingOf, songAt } from "./albumNow";
import { EMPTY, type Entry, type Queue } from "./queue";

/**
 * 生如夏花 split into three songs, then a song of its own:
 *
 * ```text
 * a  11  傲慢的上校  4:00  file:9
 * b  12  浮游        5:00  file:9
 * c  13  生如夏花    3:00  file:9
 * d  7   Melt        4:00
 * ```
 */
const TRACKS: readonly Track[] = [
  trackOf(11, "傲慢的上校", { duration_ms: 240_000, segment_of: 9 }),
  trackOf(12, "浮游", { duration_ms: 300_000, segment_of: 9 }),
  trackOf(13, "生如夏花", { duration_ms: 180_000, segment_of: 9 }),
  trackOf(7, "Melt", { duration_ms: 240_000 }),
];
const BY_ID = new Map(TRACKS.map((track) => [track.id, track]));
const ENTRIES: readonly Entry[] = [
  { key: "a", trackId: 11, unit: "file:9" },
  { key: "b", trackId: 12, unit: "file:9" },
  { key: "c", trackId: 13, unit: "file:9" },
  { key: "d", trackId: 7 },
];

const playing = (position: number, entries: readonly Entry[] = ENTRIES): Queue => ({
  ...EMPTY,
  entries,
  position,
});

describe("playingOf", () => {
  it("finds the album of the song playing, each song placed on the album's timeline", () => {
    const now = playingOf(playing(1), BY_ID);

    expect(now).toMatchObject({ kind: "album", current: 1, length: 720 });
    expect(
      now.kind === "album" &&
        now.songs.map(({ entry, start, length }) => [entry.key, start, length]),
    ).toEqual([
      ["a", 0, 240],
      ["b", 240, 300],
      ["c", 540, 180],
    ]);
  });

  it("takes a song with no unit as a song", () => {
    expect(playingOf(playing(3), BY_ID)).toEqual({ kind: "song" });
  });

  it("takes a whole album in one file as an album with no songs known", () => {
    const album = new Map([[5, trackOf(5, "Bremen", { kind: "album", duration_ms: 3_600_000 })]]);

    const now = playingOf(playing(0, [{ key: "a", trackId: 5 }]), album);

    expect(now).toEqual({ kind: "album", songs: [], current: -1, length: undefined });
  });

  it("keeps the album to the songs next to each other, not another run of its songs", () => {
    const later = [
      ...ENTRIES,
      { key: "e", trackId: 11, unit: "file:9" },
      { key: "f", trackId: 12, unit: "file:9" },
    ];

    const now = playingOf(playing(4, later), BY_ID);

    expect(now).toMatchObject({ kind: "album", current: 0, length: 540 });
  });

  it("tells apart an album queued twice in a row where its first song comes again", () => {
    const twice = [
      ...ENTRIES.slice(0, 3),
      ...ENTRIES.slice(0, 3).map((entry) => ({ ...entry, key: `${entry.key}2` })),
    ];

    const now = playingOf(playing(4, twice), BY_ID);

    expect(now).toMatchObject({ kind: "album", current: 1, length: 720 });
  });

  it("plays a unit of one song as a song", () => {
    expect(playingOf(playing(0, ENTRIES.slice(0, 1)), BY_ID)).toEqual({ kind: "song" });
  });

  it("plays songs grouped with no album named as songs", () => {
    const unnamed = new Map([
      [1, trackOf(1, "One", { album: "" })],
      [2, trackOf(2, "Two", { album: "" })],
    ]);
    const entries = [
      { key: "a", trackId: 1, unit: "album:the band\n" },
      { key: "b", trackId: 2, unit: "album:the band\n" },
    ];

    expect(playingOf(playing(0, entries), unnamed)).toEqual({ kind: "song" });
  });

  it("has no timeline when a song's length is unknown", () => {
    const unknown = new Map(BY_ID).set(
      12,
      trackOf(12, "浮游", { duration_ms: null, segment_of: 9 }),
    );

    expect(playingOf(playing(0), unknown)).toMatchObject({ kind: "album", length: undefined });
  });

  it("plays nothing as a song when the queue has finished", () => {
    expect(playingOf(playing(4), BY_ID)).toEqual({ kind: "song" });
  });
});

describe("songAt", () => {
  const now = playingOf(playing(0), BY_ID);
  const songs = now.kind === "album" ? now.songs : [];

  it("finds the song a second of the album falls in, and how far into it", () => {
    expect(songAt(songs, 0)).toEqual({ index: 0, within: 0 });
    expect(songAt(songs, 288)).toEqual({ index: 1, within: 48 });
    expect(songAt(songs, 540)).toEqual({ index: 2, within: 0 });
  });

  it("keeps the album's end in its last song", () => {
    expect(songAt(songs, 9999)).toEqual({ index: 2, within: 180 });
  });
});
