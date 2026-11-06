import { describe, expect, it } from "vitest";

import { checkParts, endOf, keptIds, listTextOf } from "./songList";

describe("a song list as text", () => {
  it("writes one song a line, its start first and its artist after a dash", () => {
    const rows = [
      { start: "0:00", title: "生如夏花", artist: "" },
      { start: "4:12", title: "傲慢的上校", artist: "朴树" },
    ];

    expect(listTextOf(rows)).toBe(`0:00 生如夏花
4:12 傲慢的上校 - 朴树`);
  });
});

describe("keeping songs when a list fills the rows", () => {
  const old = [
    { id: 11, title: "Intro", startMs: 0 },
    { id: 12, title: "Night Drive", startMs: 192_000 },
    { id: 13, title: "Encore", startMs: 600_000 },
  ];

  it("keeps each song whose title is in the list, however it was retimed or moved", () => {
    const songs = [
      { start_ms: 0, title: "night drive", artist: "" },
      { start_ms: 200_000, title: "Intro", artist: "" },
    ];

    expect(keptIds(old, songs)).toEqual([12, 11]);
  });

  it("keeps a song renamed where it starts at the same time, and makes the rest new", () => {
    const songs = [
      { start_ms: 0, title: "Overture", artist: "" },
      { start_ms: 192_000, title: "Night Drive", artist: "" },
      { start_ms: 300_000, title: "Interlude", artist: "" },
    ];

    expect(keptIds(old, songs)).toEqual([11, 12, null]);
  });

  it("keeps a song once, though two songs of the list share its title", () => {
    const songs = [
      { start_ms: 0, title: "Intro", artist: "" },
      { start_ms: 5_000, title: "Intro", artist: "" },
    ];

    expect(keptIds(old, songs)).toEqual([11, null]);
  });
});

describe("where a song ends", () => {
  it("is where the next starts, and the last where the file ends", () => {
    const starts = [0, 192_000, 600_000];

    expect([0, 1, 2].map((index) => endOf(starts, index, 900_000))).toEqual([
      192_000, 600_000, 900_000,
    ]);
  });

  it("is unknown for the last song of a file of no known length", () => {
    expect(endOf([0, 192_000], 1, null)).toBeUndefined();
  });
});

describe("checking a song by ear", () => {
  it("plays its first and last five seconds", () => {
    expect(checkParts(192_000, 600_000)).toEqual([
      { from: 192_000, to: 197_000 },
      { from: 595_000, to: 600_000 },
    ]);
  });

  it("plays a song of ten seconds or less whole", () => {
    expect(checkParts(0, 8_000)).toEqual([{ from: 0, to: 8_000 }]);
  });
});
