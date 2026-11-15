/**
 * @file Color arithmetic for a chosen accent: its readable shades, and a random one.
 *
 * Shades move only the color's lightness in OKLCH, so the hue and its strength
 * stay what was chosen; contrast is WCAG's.
 */

/** The cards an accent is read on, as the page's `--surface` tokens set them. */
export const LIGHT_SURFACE = "#ffffff";
export const DARK_SURFACE = "#151e1c";

/** Contrast an accent keeps against each surface: text on light, livelier on dark. */
const LIGHT_CONTRAST = 4.5;
const DARK_CONTRAST = 6.5;

const WHITE = "#ffffff";
const BLACK = "#000000";

/** How a chosen accent shows in each scheme, and the ink written on it. */
export interface Shades {
  readonly light: string;
  readonly lightInk: string;
  readonly dark: string;
  readonly darkInk: string;
}

/** The WCAG contrast ratio of two colors written `#` and six hex digits, from 1 to 21. */
export function contrast(one: string, other: string): number {
  const [lighter, darker] = [luminance(one), luminance(other)].sort((a, b) => b - a) as [
    number,
    number,
  ];
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * The shades of `accent` for light and dark pages: darkened until it reads on white,
 * lightened until it stands out on the dark surface, and otherwise left as chosen.
 */
export function shadesOf(accent: string): Shades {
  const light = readableOn(accent, LIGHT_SURFACE, LIGHT_CONTRAST, -1);
  const dark = readableOn(accent, DARK_SURFACE, DARK_CONTRAST, 1);
  return { light, lightInk: inkOn(light), dark, darkInk: inkOn(dark) };
}

/** White or black, whichever reads better written on `color`. */
export function inkFor(color: string): string {
  return contrast(WHITE, color) >= contrast(BLACK, color) ? WHITE : BLACK;
}

/** A color of any hue, as strong as the default accent: `random` rolls the hue. */
export function randomAccent(random: () => number = Math.random): string {
  return fromLch({ lightness: 0.62, chroma: 0.15, hue: random() * 360 });
}

/** `color`, or the nearest shade of it in `direction` that keeps `ratio` on `surface`. */
function readableOn(color: string, surface: string, ratio: number, direction: 1 | -1): string {
  if (contrast(color, surface) >= ratio) {
    return color;
  }
  const start = toLch(color);
  for (let step = 1; step <= 100; step += 1) {
    const lightness = Math.min(1, Math.max(0, start.lightness + direction * step * 0.01));
    const shade = fromLch({ ...start, lightness });
    if (contrast(shade, surface) >= ratio) {
      return shade;
    }
  }
  return direction > 0 ? WHITE : BLACK;
}

/** White, or the accent's own hue nearly black, whichever reads better on `color`. */
function inkOn(color: string): string {
  const deep = fromLch({ ...toLch(color), lightness: 0.2, chroma: 0.04 });
  return contrast(WHITE, color) >= contrast(deep, color) ? WHITE : deep;
}

interface Lch {
  readonly lightness: number;
  readonly chroma: number;
  readonly hue: number;
}

type Rgb = readonly [number, number, number];

function channels(hex: string): Rgb {
  return [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255) as unknown as Rgb;
}

function toLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function fromLinear(channel: number): number {
  return channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map(toLinear) as unknown as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function toLch(hex: string): Lch {
  const [r, g, b] = channels(hex).map(toLinear) as unknown as Rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bee = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return {
    lightness: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    chroma: Math.hypot(a, bee),
    hue: ((Math.atan2(bee, a) * 180) / Math.PI + 360) % 360,
  };
}

/** The six-digit hex color nearest `color`, giving up chroma rather than hue when it can't be shown. */
function fromLch(color: Lch): string {
  let rgb = linearOf(color);
  if (!inGamut(rgb)) {
    let [low, high] = [0, color.chroma];
    for (let round = 0; round < 24; round += 1) {
      const chroma = (low + high) / 2;
      if (inGamut(linearOf({ ...color, chroma }))) {
        low = chroma;
      } else {
        high = chroma;
      }
    }
    rgb = linearOf({ ...color, chroma: low });
  }
  return `#${rgb
    .map((channel) =>
      Math.round(Math.min(1, Math.max(0, fromLinear(channel))) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function linearOf({ lightness, chroma, hue }: Lch): Rgb {
  const radians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(radians);
  const bee = chroma * Math.sin(radians);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * bee) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * bee) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * bee) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function inGamut(rgb: Rgb): boolean {
  return rgb.every((channel) => channel >= -1e-4 && channel <= 1 + 1e-4);
}
