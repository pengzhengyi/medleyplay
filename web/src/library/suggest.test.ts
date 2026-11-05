import { describe, expect, it } from "vitest";

import { lookupOf } from "../testing/server";
import { suggestedArtist, suggestedTitle, withoutTags } from "./suggest";

describe("tags around a title", () => {
  it.each([
    ["【MV】Melt", "Melt"],
    ["Melt【MV】", "Melt"],
    ["【MV】 Melt [HD] ", "Melt"],
    ["【初音ミク】メルト【MV】【HD】", "メルト"],
    ["Melt (live)", "Melt (live)"],
    ["Re【MV】mix", "Re【MV】mix"],
  ])("removes them from the ends only: %s", (title, expected) => {
    expect(withoutTags(title)).toBe(expected);
  });

  it("keeps a title that is nothing but tags", () => {
    expect(withoutTags("【MV】")).toBe("【MV】");
  });
});

describe("suggestions for a video's parts", () => {
  it("suggests the video's title for a video with one part", () => {
    const lookup = lookupOf(1);

    expect(lookup.parts.map((part) => suggestedTitle(lookup, part))).toEqual(["Night Drive"]);
  });

  it("suggests each part's own title for a video with several parts", () => {
    const lookup = lookupOf(3);

    expect(lookup.parts.map((part) => suggestedTitle(lookup, part))).toEqual([
      "Mixtape 1",
      "Mixtape 2",
      "Mixtape 3",
    ]);
  });

  it("suggests the uploader as the artist", () => {
    expect(suggestedArtist(lookupOf(1))).toBe("Blue Room");
  });
});
