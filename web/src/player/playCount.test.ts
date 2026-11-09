import { describe, expect, it } from "vitest";

import { PlayTime, countsAsPlayed, reportOf } from "./playCount";

describe("countsAsPlayed", () => {
  it("counts half of a short Track", () => {
    expect(countsAsPlayed(59_000, 120_000)).toBe(false);
    expect(countsAsPlayed(60_000, 120_000)).toBe(true);
  });

  it("counts four minutes of a long Track", () => {
    expect(countsAsPlayed(240_000, 20 * 60_000)).toBe(true);
  });

  it("never counts a Track shorter than 30 seconds", () => {
    expect(countsAsPlayed(29_000, 29_000)).toBe(false);
  });
});

describe("reportOf", () => {
  const THREE_MINUTES = 180_000;

  it("records a play once it counts, and not before", () => {
    const listen = { counted: false, sentMs: 0 };

    expect(reportOf(listen, 89_000, THREE_MINUTES)).toBeUndefined();
    expect(reportOf(listen, 90_000, THREE_MINUTES)).toBe("record");
  });

  it("sends the time again after each further minute of listening", () => {
    const listen = { counted: true, sentMs: 90_000 };

    expect(reportOf(listen, 149_000, THREE_MINUTES)).toBeUndefined();
    expect(reportOf(listen, 150_000, THREE_MINUTES)).toBe("update");
  });

  it("sends a last time when the listen ends with time not yet sent", () => {
    expect(reportOf({ counted: true, sentMs: 90_000 }, 91_000, THREE_MINUTES, true)).toBe("update");
    expect(
      reportOf({ counted: true, sentMs: 90_000 }, 90_000, THREE_MINUTES, true),
    ).toBeUndefined();
    expect(reportOf({ counted: false, sentMs: 0 }, 60_000, THREE_MINUTES, true)).toBeUndefined();
  });
});

describe("PlayTime", () => {
  it("adds up steady playing", () => {
    const time = new PlayTime();

    for (const position of [0, 0.25, 0.5, 0.75, 1]) {
      time.update(position);
    }

    expect(time.playedMs).toBe(1000);
  });

  it("adds nothing for a seek forward or back", () => {
    const time = new PlayTime();

    for (const position of [0, 1, 90, 91, 10, 11]) {
      time.update(position);
    }

    expect(time.playedMs).toBe(3000);
  });

  it("adds nothing across a pause", () => {
    const time = new PlayTime();
    time.update(0);
    time.update(1);

    time.pause();
    time.update(1.5);
    time.update(2);

    expect(time.playedMs).toBe(1500);
  });
});
