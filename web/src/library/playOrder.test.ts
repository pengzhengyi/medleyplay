import { describe, expect, it } from "vitest";

import { trackOf } from "../testing/server";
import {
  albumUnit,
  byAlbum,
  bySong,
  everyAlbum,
  fileUnit,
  inLibraryOrder,
  songsByFile,
} from "./playOrder";

/**
 * A Library of a song, an album in one file split into three songs, an album in one
 * file not split, and two loose songs from one album, listed out of their order:
 *
 * | Id  | Title     | Kind  | Of file | Album      | Track |
 * | --- | --------- | ----- | ------- | ---------- | ----- |
 * | 1   | Melt      | song  |         | Re:Start   |       |
 * | 9   | 生如夏花   | album | split   | 生如夏花    |       |
 * | 13  | 生如夏花   | song  | 9       | 生如夏花    | 3     |
 * | 11  | 傲慢的上校 | song  | 9       | 生如夏花    | 1     |
 * | 12  | 浮游      | song  | 9       | 生如夏花    | 2     |
 * | 20  | Bremen    | album |         | Bremen     |       |
 * | 31  | Sky       | song  |         | Blue       | 2     |
 * | 30  | Intro     | song  |         | Blue       | 1     |
 */
const LIBRARY = [
  trackOf(1, "Melt", { album: "Re:Start" }),
  trackOf(9, "生如夏花", { album: "生如夏花", kind: "album", split: true }),
  trackOf(13, "生如夏花", { album: "生如夏花", segment_of: 9, track_number: 3 }),
  trackOf(11, "傲慢的上校", { album: "生如夏花", segment_of: 9, track_number: 1 }),
  trackOf(12, "浮游", { album: "生如夏花", segment_of: 9, track_number: 2 }),
  trackOf(20, "Bremen", { album: "Bremen", kind: "album", duration_ms: 3_600_000 }),
  trackOf(31, "Sky", { album: "Blue", track_number: 2 }),
  trackOf(30, "Intro", { album: "Blue", track_number: 1 }),
];

const idsOf = (tracks: readonly { readonly id: number }[]) => tracks.map((track) => track.id);
const items = LIBRARY.filter((track) => track.segment_of === null);

describe("the songs of each split file", () => {
  it("are its songs in their order", () => {
    expect([...songsByFile(LIBRARY)].map(([file, songs]) => [file, idsOf(songs)])).toEqual([
      [9, [11, 12, 13]],
    ]);
  });
});

describe("the Library's order", () => {
  it("plays each item in its place, a split file as its songs", () => {
    expect(idsOf(inLibraryOrder(items, songsByFile(LIBRARY)))).toEqual([1, 11, 12, 13, 20, 31, 30]);
  });

  it("keeps a split file's songs together as one unit", () => {
    expect(LIBRARY.map(fileUnit)).toEqual([
      undefined,
      undefined,
      "file:9",
      "file:9",
      "file:9",
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe("by album", () => {
  it("plays each album whole in its track order, in the order the albums first appear", () => {
    expect(idsOf(byAlbum(inLibraryOrder(items, songsByFile(LIBRARY))))).toEqual([
      1, 11, 12, 13, 20, 30, 31,
    ]);
  });

  it("keeps each album's songs together as one unit, by its album artist and name", () => {
    const [intro, sky] = [LIBRARY[7], LIBRARY[6]].map((track) => track && albumUnit(track));

    expect(intro).toBe(sky);
    expect(intro).not.toBe(LIBRARY[0] && albumUnit(LIBRARY[0]));
  });
});

describe("every album", () => {
  it("plays each album whole, in the order the Albums view lists them", () => {
    const songs = LIBRARY.filter((track) => !track.split);

    expect(idsOf(everyAlbum(songs))).toEqual([30, 31, 20, 1, 11, 12, 13]);
  });
});

describe("by song", () => {
  it("plays every song, leaving out an album file that isn't split", () => {
    expect(idsOf(bySong(inLibraryOrder(items, songsByFile(LIBRARY))))).toEqual([
      1, 11, 12, 13, 31, 30,
    ]);
  });
});
