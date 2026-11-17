import { describe, expect, it } from "vitest";

import type { Credit } from "../api";
import { withCredit, withoutCredit, onlyArtist, sameCredits, toggled } from "./credits";

const main = (written: string): Credit => ({ written, role: "main" });
const featured = (written: string): Credit => ({ written, role: "featured" });

describe("a song's artists, one chip each", () => {
  it("adds an artist after the others, trimmed, as a main artist", () => {
    expect(withCredit([main("スズム")], "  GUMI ")).toEqual([main("スズム"), main("GUMI")]);
  });

  it("adds no artist twice, nor one with no name", () => {
    const chips = [main("GUMI")];

    expect(withCredit(chips, "gumi")).toBe(chips);
    expect(withCredit(chips, "   ")).toBe(chips);
  });

  it("toggles an artist between main and featured in its place", () => {
    const chips = [main("スズム"), main("GUMI"), main("MAYU")];

    expect(toggled(chips, 1)).toEqual([main("スズム"), featured("GUMI"), main("MAYU")]);
    expect(toggled(toggled(chips, 1), 1)).toEqual(chips);
  });

  it("makes the first artist left main when the last main one is removed", () => {
    const chips = [main("スズム"), featured("GUMI"), featured("MAYU")];

    expect(withoutCredit(chips, 0)).toEqual([main("GUMI"), featured("MAYU")]);
  });

  it("is one artist as written once one main artist is left", () => {
    expect(onlyArtist([main("GUMI")])).toBe("GUMI");
    expect(onlyArtist([main("GUMI"), featured("MAYU")])).toBeUndefined();
    expect(onlyArtist([])).toBeUndefined();
  });

  it("is the same as the artists a song shows whatever the order of roles", () => {
    const shows = [main("スズム"), featured("GUMI")];

    expect(sameCredits([featured("GUMI"), main("スズム")], shows)).toBe(true);
    expect(sameCredits([main("スズム"), main("GUMI")], shows)).toBe(false);
    expect(sameCredits([main("スズム")], shows)).toBe(false);
  });
});
