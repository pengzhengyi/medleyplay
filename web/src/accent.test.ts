import { afterEach, describe, expect, it } from "vitest";

import {
  MAX_SAVED_COLORS,
  applyAccent,
  forgetColor,
  saveColor,
  savedAccent,
  savedColors,
} from "./accent";
import { shadesOf } from "./color";

const root = () => document.documentElement.style;

afterEach(() => {
  applyAccent(undefined);
  localStorage.clear();
});

describe("the accent color", () => {
  it("is jade until a browser chooses one", () => {
    expect(savedAccent()).toBeUndefined();
    expect(root().getPropertyValue("--chosen-accent-light")).toBe("");
  });

  it("colors each scheme with its own shade of the accent chosen, and remembers it", () => {
    applyAccent("#FFD84D");

    const shades = shadesOf("#ffd84d");
    expect(root().getPropertyValue("--chosen-accent-light")).toBe(shades.light);
    expect(root().getPropertyValue("--chosen-accent-ink-light")).toBe(shades.lightInk);
    expect(root().getPropertyValue("--chosen-accent-dark")).toBe(shades.dark);
    expect(root().getPropertyValue("--chosen-accent-ink-dark")).toBe(shades.darkInk);
    expect(savedAccent()).toBe("#ffd84d");
  });

  it("goes back to jade, forgetting the choice", () => {
    applyAccent("#7a3fd1");

    applyAccent(undefined);

    expect(root().getPropertyValue("--chosen-accent-dark")).toBe("");
    expect(savedAccent()).toBeUndefined();
  });

  it("ignores a saved value that isn't a color", () => {
    localStorage.setItem("medleyplay.accent", "url(evil)");

    expect(savedAccent()).toBeUndefined();
  });
});

describe("the colors kept to choose again", () => {
  it("keeps none at first", () => {
    expect(savedColors()).toEqual([]);
  });

  it("puts the color saved last first", () => {
    saveColor("#7A3FD1");
    saveColor("#ffd84d");

    expect(savedColors()).toEqual(["#ffd84d", "#7a3fd1"]);
  });

  it("moves a color saved again to the front, keeping it once", () => {
    saveColor("#7a3fd1");
    saveColor("#ffd84d");

    saveColor("#7a3fd1");

    expect(savedColors()).toEqual(["#7a3fd1", "#ffd84d"]);
  });

  it("forgets the oldest once it keeps the most it can", () => {
    const colors = Array.from(
      { length: MAX_SAVED_COLORS + 1 },
      (_, index) => `#0000${index.toString(16).padStart(2, "0")}`,
    );

    for (const color of colors) {
      saveColor(color);
    }

    expect(savedColors()).toHaveLength(MAX_SAVED_COLORS);
    expect(savedColors()).not.toContain(colors[0]);
    expect(savedColors()[0]).toBe(colors.at(-1));
  });

  it("forgets a color when asked", () => {
    saveColor("#7a3fd1");
    saveColor("#ffd84d");

    forgetColor("#7A3FD1");

    expect(savedColors()).toEqual(["#ffd84d"]);
  });

  it("ignores saved values that aren't colors", () => {
    localStorage.setItem("medleyplay.saved-colors", JSON.stringify(["#7a3fd1", "url(evil)", 3]));

    expect(savedColors()).toEqual(["#7a3fd1"]);
  });
});
