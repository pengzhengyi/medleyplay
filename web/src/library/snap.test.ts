import { describe, expect, it } from "vitest";

import type { Silence } from "../api";
import { snapStarts } from "./snap";

const gap = (start: number, end: number): Silence => ({
  start_ms: start * 1000,
  end_ms: end * 1000,
});

/** The gaps ffmpeg found in a 48-minute upload of Michael Jackson's *Bad*, in seconds. */
const BAD: readonly Silence[] = [
  gap(0, 0.656),
  gap(246.307, 247.672),
  gap(542.241, 542.763),
  gap(542.763, 545.774),
  gap(1013.951, 1020.552),
  gap(1261.81, 1267.86),
];

const seconds = (ms: readonly (number | undefined)[]) =>
  ms.map((each) => (each === undefined ? undefined : each / 1000));

describe("snapping starts to the gaps in the audio", () => {
  it("moves each start to the end of the gap nearest it", () => {
    const starts = [0, 248_000, 545_000, 1_020_000, 1_268_000];

    expect(seconds(snapStarts(starts, BAD))).toEqual([0, 247.672, 545.774, 1020.552, 1267.86]);
  });

  it("leaves a start with no gap within half a minute where it is", () => {
    // Liberian Girl runs on from Speed Demon with no silence between them.
    const starts = [0, 545_000, 788_000, 1_020_000];

    expect(seconds(snapStarts(starts, BAD))).toEqual([0, 545.774, 788, 1020.552]);
  });

  it("keeps the first song at its start, though the file opens with a moment of silence", () => {
    expect(snapStarts([0, 248_000], BAD)[0]).toBe(0);
  });

  it("joins silences closer than a second into one gap", () => {
    // 542.2 s to 542.8 s and 542.8 s to 545.8 s are one gap, ending at 545.8 s.
    expect(seconds(snapStarts([0, 543_000], BAD))).toEqual([0, 545.774]);
  });

  it("keeps the songs in order, and gives each gap to one song", () => {
    const starts = [0, 1_015_000, 1_019_000];

    expect(seconds(snapStarts(starts, BAD))).toEqual([0, 1015, 1020.552]);
  });

  it("leaves a start of no time as it is", () => {
    expect(snapStarts([0, undefined, 548_000], BAD)).toEqual([0, undefined, 545_774]);
  });
});
