import { describe, expect, it } from "vitest";

import type { LyricLine } from "./api";
import { firstLinesOf, lineAt, songTimeOf } from "./lyrics";
import type { Playing } from "./player/albumNow";
import { trackOf } from "./testing/server";

/** Three lines, at 12.34 s, 15.5 s, and 62 s. */
const MELT: readonly LyricLine[] = [
  { at_ms: 12_340, text: "朝目が覚めて", translation: "", words: [] },
  { at_ms: 15_500, text: "真っ先に思い浮かぶ", translation: "", words: [] },
  { at_ms: 62_000, text: "君のこと", translation: "", words: [] },
];

describe("the line sung at a time", () => {
  it("is none before the first line", () => {
    expect(lineAt(MELT, 12_339)).toBe(-1);
  });

  it("is the last line started, from the moment it starts", () => {
    expect([12_340, 15_499, 15_500, 61_999, 600_000].map((ms) => lineAt(MELT, ms))).toEqual([
      0, 0, 1, 1, 2,
    ]);
  });

  it("is none for lyrics with no lines", () => {
    expect(lineAt([], 5_000)).toBe(-1);
  });
});

describe("how far into the song playing", () => {
  const file = trackOf(9, "Bremen", { kind: "album", split: true });
  const second = trackOf(11, "Last", { segment_of: 9 });

  it("is the position for a song of its own", () => {
    const song = trackOf(1, "Melt");

    expect(songTimeOf(song, { kind: "song" }, 42)).toEqual({ song, from: 0, seconds: 42 });
  });

  it("starts where a file playing whole reaches its song", () => {
    const playing: Playing = {
      kind: "album",
      songs: [
        { entry: { key: "a", trackId: 10 }, track: undefined, start: 0, from: 0, length: 252 },
        { entry: { key: "b", trackId: 11 }, track: second, start: 252, from: 252, length: 200 },
      ],
      current: 1,
      length: 452,
    };

    expect(songTimeOf(file, playing, 260)).toEqual({ song: second, from: 252, seconds: 8 });
  });
});

describe("the first lines of lyrics", () => {
  it("are the lines as sung, without their times or the lines naming the song", () => {
    const text = `[ar:ryo]
[ti:Melt]
[00:12.34]<00:12.34>朝目が<00:13.00>覚めて

[00:15.50]真っ先に思い浮かぶ
[00:18.00]君の顔
`;

    expect(firstLinesOf(text)).toEqual(["朝目が覚めて", "真っ先に思い浮かぶ"]);
  });

  it("are plain lyrics' first lines as written", () => {
    expect(firstLinesOf("故事的小黄花\n从出生那年就飘着\n童年的荡秋千", 1)).toEqual([
      "故事的小黄花",
    ]);
  });
});
