import { describe, expect, it } from "vitest";

import { trackOf } from "../testing/server";
import { artistAskedOf, completionsOf, suggestedArtists } from "./suggestions";

/** Songs by 周杰伦, 周深, and ryo, four, two, and one of them. */
const TRACKS = [
  ...[1, 2, 3, 4].map((id) => trackOf(id, `Song ${String(id)}`, { artist: "周杰伦" })),
  ...[5, 6].map((id) => trackOf(id, `Song ${String(id)}`, { artist: "周深" })),
  trackOf(7, "Melt", { artist: "ryo" }),
];

describe("the artist a search asks about", () => {
  it.each([
    ["周", "周"],
    ["artist:周", "周"],
    ['artist:"Jay Chou" melt', "Jay Chou"],
    ["album:Supercell", ""],
    ["", ""],
  ])("is %j's %j", (text, asked) => {
    expect(artistAskedOf(text)).toBe(asked);
  });
});

describe("the artists suggested", () => {
  it("are those the search finds by name, at most three", () => {
    expect(suggestedArtists(TRACKS, "周").map((artist) => artist.name)).toEqual(["周杰伦", "周深"]);
  });

  it("are none for a search that asks about no artist", () => {
    expect(suggestedArtists(TRACKS, "album:Supercell")).toEqual([]);
  });
});

describe("the tags and sites a word being typed completes", () => {
  it.each([
    ["bi", [{ site: "bilibili" }]],
    ["BI", [{ site: "bilibili" }]],
    ["ar", [{ tag: "artist" }]],
    ["artist", [{ tag: "artist" }]],
    ["so", [{ tag: "song" }]],
    ["fa", [{ tag: "favorite" }]],
  ])("are, for %j, %j", (typed, completions) => {
    expect(completionsOf(typed, ["bilibili"]).completions).toEqual(completions);
  });

  it.each([
    ["a", "a single letter, which begins too many"],
    ["melt ", "a word already finished"],
    ["bilibili:", "a name already completed"],
    ["xyz", "a word no name begins"],
  ])("are none for %j, %s", (typed) => {
    expect(completionsOf(typed, ["bilibili"]).completions).toEqual([]);
  });

  it("include no site that cannot be searched", () => {
    expect(completionsOf("bi", []).completions).toEqual([]);
  });

  it("complete the last word, keeping the words before it", () => {
    expect(completionsOf("melt ar", ["bilibili"])).toEqual({
      before: "melt",
      completions: [{ tag: "artist" }],
    });
  });
});
