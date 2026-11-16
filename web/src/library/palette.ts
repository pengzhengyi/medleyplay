/**
 * @file A cover's palette: its most common colors, each far enough from the others to
 * tell apart, read from a small copy of it.
 */

/** A color as red, green, and blue, each from 0 to 1. */
export type Color = readonly [number, number, number];

/** How far apart, in 0–255 RGB, two colors of a palette are at least. */
const APART = 60;
/** The color of an image with none: a dark gray. */
const NONE: Color = [0.16, 0.16, 0.16];

/**
 * Return `count` colors of the RGBA `pixels`, most common first, each at least `APART`
 * from the others; the first repeats when there are fewer.
 */
export function paletteOf(pixels: Uint8ClampedArray, count: number): Color[] {
  // Colors are counted in buckets of 32 a channel, each bucket keeping its average.
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let at = 0; at + 3 < pixels.length; at += 4) {
    const [r = 0, g = 0, b = 0] = [pixels[at], pixels[at + 1], pixels[at + 2]];
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const bucket = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    bucket.n += 1;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }
  const chosen: Color[] = [];
  for (const { n, r, g, b } of [...buckets.values()].sort((one, other) => other.n - one.n)) {
    const color: Color = [r / n, g / n, b / n];
    if (chosen.every((each) => distance(each, color) >= APART)) {
      chosen.push(color);
    }
    if (chosen.length === count) {
      break;
    }
  }
  const palette = chosen.map(([r, g, b]): Color => [r / 255, g / 255, b / 255]);
  return Array.from({ length: count }, (_, place) => palette[place] ?? palette[0] ?? NONE);
}

function distance(one: Color, other: Color): number {
  return Math.hypot(one[0] - other[0], one[1] - other[1], one[2] - other[2]);
}
