import { describe, expect, it, vi } from "vitest";

import type { Track } from "../api";
import { trackOf } from "../testing/server";
import { albumSteps, albumTimeline, playingOf, songAt } from "./albumNow";
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

  it("finds the album of songs of one file queued one after another with no unit", () => {
    const loose = ENTRIES.map(({ key, trackId }) => ({ key, trackId }));

    expect(playingOf(playing(2, loose), BY_ID)).toMatchObject({
      kind: "album",
      current: 2,
      length: 720,
    });
  });

  it("takes a song with no unit as a song", () => {
    expect(playingOf(playing(3), BY_ID)).toEqual({ kind: "song" });
  });

  it("takes a whole album in one file as an album with no songs known", () => {
    const album = new Map([[5, trackOf(5, "Bremen", { kind: "album", duration_ms: 3_600_000 })]]);

    const now = playingOf(playing(0, [{ key: "a", trackId: 5 }]), album);

    expect(now).toEqual({ kind: "album", songs: [], current: -1, length: undefined });
  });

  it("takes a whole file playing whole after it was split as an album of its songs, the one under the position playing", () => {
    const split = new Map([
      [9, trackOf(9, "生如夏花", { kind: "album", split: true, duration_ms: 720_000 })],
      ...BY_ID,
    ]);

    const now = playingOf(playing(0, [{ key: "w", trackId: 9 }]), split, 300);

    expect(now).toMatchObject({ kind: "album", current: 1, length: 720 });
    expect(
      now.kind === "album" &&
        now.songs.map(({ entry, start, from, track }) => [entry.key, start, from, track?.id]),
    ).toEqual([
      ["w", 0, 0, 11],
      ["w", 240, 240, 12],
      ["w", 540, 540, 13],
    ]);
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

describe("albumTimeline", () => {
  it("places the song playing on the album's timeline, with where each song starts", () => {
    const timeline = albumTimeline(playingOf(playing(1), BY_ID), 48, vi.fn());

    expect(timeline?.position).toBe(288);
    expect(timeline?.length).toBe(720);
    expect(timeline?.marks).toEqual([
      { start: 0, title: "傲慢的上校" },
      { start: 240, title: "浮游" },
      { start: 540, title: "生如夏花" },
    ]);
  });

  it("seeks by playing the song the second falls in, from that far into it", () => {
    const now = playingOf(playing(0), BY_ID);
    const playSong = vi.fn();

    albumTimeline(now, 0, playSong)?.seek(600);

    expect(playSong).toHaveBeenCalledWith(now.kind === "album" ? now.songs[2] : undefined, 60);
  });

  it("places a whole file playing whole on its own timeline, and seeks within it", () => {
    const split = new Map([
      [9, trackOf(9, "生如夏花", { kind: "album", split: true, duration_ms: 720_000 })],
      ...BY_ID,
    ]);
    const now = playingOf(playing(0, [{ key: "w", trackId: 9 }]), split, 300);
    const playSong = vi.fn();

    const timeline = albumTimeline(now, 300, playSong);
    timeline?.seek(600);

    expect(timeline?.position).toBe(300);
    expect(playSong).toHaveBeenCalledWith(now.kind === "album" ? now.songs[2] : undefined, 600);
  });

  it("is nothing while a song of its own plays", () => {
    expect(albumTimeline(playingOf(playing(3), BY_ID), 10, vi.fn())).toBeUndefined();
  });
});

describe("albumSteps", () => {
  /** 生如夏花's three songs, then Melt, then the same three songs as a second album. */
  const TWICE: readonly Entry[] = [
    ...ENTRIES,
    { key: "e", trackId: 11, unit: "file:9" },
    { key: "f", trackId: 12, unit: "file:9" },
    { key: "g", trackId: 13, unit: "file:9" },
  ];
  const stepsAt = (place: number, position: number, entries: readonly Entry[] = TWICE) => {
    const queue = playing(place, entries);
    return albumSteps(queue, BY_ID, playingOf(queue, BY_ID, position), position);
  };

  it("steps to the song after, and to the albums either side, from an album's first song", () => {
    expect(stepsAt(4, 1)).toEqual({
      previousSong: { key: "e", seconds: 0 },
      nextSong: { key: "f", seconds: 0 },
      previousAlbum: { key: "d", seconds: 0 },
      nextAlbum: undefined,
    });
  });

  it("goes back a song, and to the album's start once the album is a few seconds in", () => {
    expect(stepsAt(5, 1)).toMatchObject({
      previousSong: { key: "e", seconds: 0 },
      nextSong: { key: "g", seconds: 0 },
      previousAlbum: { key: "e", seconds: 0 },
    });
  });

  it("goes back to the start of the song once a few seconds into it", () => {
    expect(stepsAt(5, 10)).toMatchObject({ previousSong: { key: "f", seconds: 0 } });
  });

  it("steps from the first album to the song after it", () => {
    expect(stepsAt(0, 1)).toMatchObject({
      previousSong: { key: "a", seconds: 0 },
      previousAlbum: { key: "a", seconds: 0 },
      nextAlbum: { key: "d", seconds: 0 },
    });
  });

  it("steps by song within a split file playing whole, and by album past it", () => {
    const split = new Map([
      [9, trackOf(9, "生如夏花", { kind: "album", split: true, duration_ms: 720_000 })],
      ...BY_ID,
    ]);
    const entries = [
      { key: "w", trackId: 9 },
      { key: "d", trackId: 7 },
    ];
    const queue = playing(0, entries);

    const steps = albumSteps(queue, split, playingOf(queue, split, 300), 300);

    expect(steps).toEqual({
      previousSong: { key: "w", seconds: 240 },
      nextSong: { key: "w", seconds: 540 },
      previousAlbum: { key: "w", seconds: 0 },
      nextAlbum: { key: "d", seconds: 0 },
    });
  });

  it("has no songs to step through in a whole album not yet split", () => {
    const album = new Map([[5, trackOf(5, "Bremen", { kind: "album", duration_ms: 3_600_000 })]]);
    const queue = playing(0, [{ key: "a", trackId: 5 }]);

    const steps = albumSteps(queue, album, playingOf(queue, album, 30), 30);

    expect(steps).toEqual({
      previousSong: undefined,
      nextSong: undefined,
      previousAlbum: { key: "a", seconds: 0 },
      nextAlbum: undefined,
    });
  });

  it("is nothing while a song of its own plays", () => {
    expect(stepsAt(3, 1)).toBeUndefined();
  });
});
