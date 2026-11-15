import { afterEach, describe, expect, it } from "vitest";

import { applyAccent, savedAccent } from "./accent";
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
