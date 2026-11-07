import { describe, expect, it } from "vitest";

import {
  formatMinutes,
  formatTimeLeft,
  formatBytes,
  formatLength,
  formatLibraryLength,
  formatQueueLength,
  formatSeen,
  formatTime,
} from "./format";

describe("formatTime", () => {
  it("writes minutes and two-digit seconds", () => {
    expect(formatTime(187.9)).toBe("3:07");
    expect(formatTime(0)).toBe("0:00");
  });

  it("writes an unknown length as dashes", () => {
    expect(formatTime(undefined)).toBe("–:––");
    expect(formatTime(Number.NaN)).toBe("–:––");
  });
});

describe("formatLength", () => {
  it("writes how many songs and how long they play, in minutes or hours", () => {
    expect(formatLength(1, 240_000)).toBe("1 song, 4 min");
    expect(formatLength(12, 2_880_000)).toBe("12 songs, 48 min");
    expect(formatLength(30, 6_300_000)).toBe("30 songs, 1 hr 45 min");
  });

  it("leaves the length out when it is unknown", () => {
    expect(formatLength(2, 0)).toBe("2 songs");
  });
});

describe("formatQueueLength", () => {
  const now = new Date(2026, 10, 6, 14, 45);

  it("writes what is queued and, while it plays on, when it ends on the clock", () => {
    const at = new Date(2026, 10, 6, 16, 30);

    expect(formatQueueLength(12, 6_300_000, { now, at })).toMatch(
      /^12 songs, 1 hr 45 min, ending around 4:30\sPM$/u,
    );
  });

  it("names the day a queue ending after today ends on", () => {
    const at = new Date(2026, 10, 11, 2, 12);

    expect(formatQueueLength(152, 438_540_000, { now, at })).toMatch(
      /^152 songs, 121 hr 49 min, ending around Wed 2:12\sAM$/u,
    );
  });

  it("writes only what is queued when it ends a week or more away", () => {
    const at = new Date(2026, 10, 13, 15, 0);

    expect(formatQueueLength(900, 605_000_000, { now, at })).toBe("900 songs, 168 hr 3 min");
  });

  it("writes only what is queued when it won't end on its own", () => {
    expect(formatQueueLength(12, 6_300_000)).toBe("12 songs, 1 hr 45 min");
  });
});

describe("formatBytes", () => {
  it("writes sizes in decimal units, with a decimal place below a hundred when it counts", () => {
    expect(formatBytes(512)).toBe("512 bytes");
    expect(formatBytes(420_000_000)).toBe("420 MB");
    expect(formatBytes(3_210_000_000)).toBe("3.2 GB");
    expect(formatBytes(2_000_000_000_000)).toBe("2 TB");
  });
});

describe("formatLibraryLength", () => {
  it("counts the albums, then the songs, then how long they all play", () => {
    expect(formatLibraryLength(2, 12, 6_000_000)).toBe("2 albums, 12 songs, 1 hr 40 min");
    expect(formatLibraryLength(1, 1, 240_000)).toBe("1 album, 1 song, 4 min");
  });

  it("says only the songs when there is no album", () => {
    expect(formatLibraryLength(0, 3, 600_000)).toBe("3 songs, 10 min");
  });
});

describe("formatMinutes", () => {
  it("writes a sleep timer's choice in words", () => {
    expect([15, 30, 45, 60, 90, 120].map(formatMinutes)).toEqual([
      "15 minutes",
      "30 minutes",
      "45 minutes",
      "1 hour",
      "1 hour 30 minutes",
      "2 hours",
    ]);
  });
});

describe("formatTimeLeft", () => {
  it("writes the time left in whole minutes, rounded up", () => {
    expect(formatTimeLeft(28 * 60_000 + 1)).toBe("29 min");
    expect(formatTimeLeft(90 * 60_000)).toBe("1 hr 30 min");
    expect(formatTimeLeft(120 * 60_000)).toBe("2 hr");
  });

  it("writes a last part of a minute as 1 min", () => {
    expect(formatTimeLeft(5_000)).toBe("1 min");
  });
});

describe("formatSeen", () => {
  const NOW = Date.parse("2026-11-07T18:00:00Z");

  it("says just now within the minute", () => {
    expect(formatSeen(NOW - 59_000, NOW)).toBe("Just now");
  });

  it("counts minutes, then hours, back to a day ago", () => {
    expect(formatSeen(NOW - 5 * 60_000, NOW)).toBe("5 min ago");
    expect(formatSeen(NOW - 3 * 3_600_000, NOW)).toBe("3 hr ago");
  });

  it("names the day for anything older", () => {
    const seen = Date.parse("2026-11-01T12:00:00Z");

    expect(formatSeen(seen, NOW)).toBe(
      new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(seen),
    );
  });
});
