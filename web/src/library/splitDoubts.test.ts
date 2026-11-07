import { describe, expect, it } from "vitest";

import { countsDisagree, doubtsOf } from "./splitDoubts";

const MINUTE = 60_000;

describe("what looks wrong with a split", () => {
  it("doubts a song so long it may be two", () => {
    // 0:00 Intro, 4:00 Night Drive, 24:00 Encore, in a 28-minute file.
    const starts = [0, 4 * MINUTE, 24 * MINUTE];

    expect([...doubtsOf(starts, 28 * MINUTE).long]).toEqual([1]);
  });

  it("doubts a file shared by so few songs that one may be missing", () => {
    // 0:00 Colorful Days, 24:00 生如夏花, in a 48-minute file.
    expect(doubtsOf([0, 24 * MINUTE], 48 * MINUTE).few).toBe(true);
  });

  it("doubts nothing of an album of songs of usual lengths", () => {
    const starts = Array.from({ length: 12 }, (_, index) => index * 4 * MINUTE);

    expect(doubtsOf(starts, 48 * MINUTE)).toEqual({ long: new Set(), few: false });
  });

  it("doubts nothing it can't measure: a start not typed yet, or a file of unknown length", () => {
    expect(doubtsOf([0, undefined], null)).toEqual({ long: new Set(), few: false });
  });
});

describe("whether the lists found disagree", () => {
  it("names the sources whose counts differ", () => {
    expect(
      countsDisagree([
        { name: "the video", count: 12 },
        { name: "the AI", count: 4 },
      ]),
    ).toBe("The video lists 12 songs, the AI 4.");
  });

  it("says nothing when every list has as many songs, or there is only one", () => {
    expect(
      countsDisagree([
        { name: "the video", count: 12 },
        { name: "the AI", count: 12 },
      ]),
    ).toBeNull();
    expect(countsDisagree([{ name: "the AI", count: 4 }])).toBeNull();
  });
});
