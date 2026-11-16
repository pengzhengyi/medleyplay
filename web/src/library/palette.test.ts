import { describe, expect, it } from "vitest";

import { paletteOf } from "./palette";

type Rgb = readonly [number, number, number];

/** The RGBA pixels of an image with `count` pixels of each color given. */
function pixelsOf(...parts: readonly (readonly [Rgb, number])[]): Uint8ClampedArray {
  return new Uint8ClampedArray(
    parts.flatMap(([[r, g, b], count]) =>
      Array.from({ length: count }, () => [r, g, b, 255]).flat(),
    ),
  );
}

const RED: Rgb = [200, 30, 30];
const NEAR_RED: Rgb = [210, 40, 35];
const GREEN: Rgb = [30, 180, 60];
const BLUE: Rgb = [20, 40, 200];

describe("a cover's palette", () => {
  it("is its most common colors first, each far from the others", () => {
    const palette = paletteOf(pixelsOf([RED, 50], [NEAR_RED, 40], [GREEN, 30], [BLUE, 10]), 3);

    expect(palette).toEqual([RED, GREEN, BLUE].map((rgb) => rgb.map((v) => v / 255)));
  });

  it("repeats its first color when it has fewer than asked", () => {
    const palette = paletteOf(pixelsOf([GREEN, 4]), 3);

    expect(palette).toHaveLength(3);
    expect(new Set(palette.map(String)).size).toBe(1);
  });

  it("is a dark gray for an image with no pixels", () => {
    expect(paletteOf(new Uint8ClampedArray(), 2)).toEqual([
      [0.16, 0.16, 0.16],
      [0.16, 0.16, 0.16],
    ]);
  });
});
