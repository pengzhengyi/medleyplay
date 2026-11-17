import { describe, expect, it } from "vitest";

import { linesOf, lrcOf, lrcTime, nudged, shifted, stamped } from "./lrc";

const MELT = `[ti:Melt]
[00:12.34]朝目が覚めて

真っ先に思い浮かぶ
[01:02.5][02:02.5]君のこと
`;

describe("lyrics to sync", () => {
  it("are each line, with its first time once stamped, leaving out tags and blank lines", () => {
    expect(linesOf(MELT)).toEqual([
      { at_ms: 12_340, text: "朝目が覚めて" },
      { at_ms: null, text: "真っ先に思い浮かぶ" },
      { at_ms: 62_500, text: "君のこと" },
    ]);
  });

  it("are every line of plain lyrics, none stamped", () => {
    expect(linesOf("Here comes\r\nthe morning")).toEqual([
      { at_ms: null, text: "Here comes" },
      { at_ms: null, text: "the morning" },
    ]);
  });

  it("are written back as LRC, a line not stamped as written", () => {
    expect(lrcOf(linesOf(MELT))).toBe(`[00:12.34]朝目が覚めて
真っ先に思い浮かぶ
[01:02.50]君のこと
`);
  });

  it("time a line to the hundredth of a second, minutes past an hour too", () => {
    expect([0, 62_345, 3_725_000].map(lrcTime)).toEqual(["[00:00.00]", "[01:02.35]", "[62:05.00]"]);
  });
});

describe("syncing lyrics", () => {
  const lines = linesOf(MELT);

  it("stamps a line at the time played", () => {
    expect(stamped(lines, 1, 15_500.4)[1]).toEqual({ at_ms: 15_500, text: "真っ先に思い浮かぶ" });
  });

  it("nudges one stamped line a tenth of a second, never before the start", () => {
    expect(nudged(lines, 0, 100)[0]?.at_ms).toBe(12_440);
    expect(nudged(stamped(lines, 0, 50), 0, -100)[0]?.at_ms).toBe(0);
    expect(nudged(lines, 1, 100)[1]?.at_ms).toBeNull();
  });

  it("shifts every stamped line at once", () => {
    expect(shifted(lines, -340).map((line) => line.at_ms)).toEqual([12_000, null, 62_160]);
  });
});
