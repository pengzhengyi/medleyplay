import { describe, expect, it } from "vitest";

import { DARK_SURFACE, LIGHT_SURFACE, contrast, inkFor, randomAccent, shadesOf } from "./color";

describe("contrast", () => {
  it("is 21 between black and white, and 1 between a color and itself", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#0b8a70", "#0b8a70")).toBeCloseTo(1, 5);
  });

  it("reads the same either way round", () => {
    expect(contrast("#0b8a70", "#ffffff")).toBeCloseTo(contrast("#ffffff", "#0b8a70"), 10);
  });
});

describe("the shades of a chosen accent", () => {
  it("keeps a color that already reads well on both surfaces", () => {
    const shades = shadesOf("#7a3fd1");

    expect(shades.light).toBe("#7a3fd1");
    expect(contrast(shades.dark, DARK_SURFACE)).toBeGreaterThanOrEqual(6.5);
  });

  it("darkens a pale color for light pages, keeping it readable on white", () => {
    const shades = shadesOf("#ffd84d");

    expect(contrast(shades.light, LIGHT_SURFACE)).toBeGreaterThanOrEqual(4.5);
    expect(shades.dark).toBe("#ffd84d");
  });

  it("lightens a deep color for dark pages", () => {
    const shades = shadesOf("#1a237e");

    expect(shades.light).toBe("#1a237e");
    expect(contrast(shades.dark, DARK_SURFACE)).toBeGreaterThanOrEqual(6.5);
  });

  it("writes on each shade in whichever ink reads better", () => {
    const pale = shadesOf("#ffd84d");
    const deep = shadesOf("#1a237e");

    expect(deep.lightInk).toBe("#ffffff");
    expect(contrast(pale.darkInk, pale.dark)).toBeGreaterThan(contrast("#ffffff", pale.dark));
  });

  it("keeps the hue of the color chosen, give or take a few degrees", () => {
    const { light, dark } = shadesOf("#e0245e");

    expect(Math.abs(hueOf(light) - hueOf("#e0245e"))).toBeLessThan(10);
    expect(Math.abs(hueOf(dark) - hueOf("#e0245e"))).toBeLessThan(10);
  });
});

describe("the ink written on a color", () => {
  it("is white on a deep color and black on a pale one", () => {
    expect(inkFor("#1a237e")).toBe("#ffffff");
    expect(inkFor("#ffd84d")).toBe("#000000");
  });
});

describe("a random accent", () => {
  it("turns the dice into a hue, so each roll is a different color", () => {
    const first = randomAccent(() => 0.1);
    const second = randomAccent(() => 0.6);

    expect(first).toMatch(/^#[0-9a-f]{6}$/);
    expect(second).not.toBe(first);
  });

  it("is never so grey that it reads as no accent", () => {
    for (const roll of [0, 0.25, 0.5, 0.75, 0.99]) {
      const [r, g, b] = channels(randomAccent(() => roll));

      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeGreaterThan(60);
    }
  });
});

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)) as [
    number,
    number,
    number,
  ];
}

/** The color's hue on the HSL wheel, in degrees. */
function hueOf(hex: string): number {
  const [r, g, b] = channels(hex).map((channel) => channel / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const span = max - Math.min(r, g, b);
  const sixth = max === r ? (g - b) / span : max === g ? (b - r) / span + 2 : (r - g) / span + 4;
  return (sixth * 60 + 360) % 360;
}
