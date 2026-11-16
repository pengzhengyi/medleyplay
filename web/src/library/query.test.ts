// cspell:ignore loveartist
import { describe, expect, it } from "vitest";

import { fieldTyped, parseQuery, querySaid, queryText, siteTyped } from "./query";

describe("a search's text", () => {
  it("holds tags naming a field, and plain words", () => {
    expect(parseQuery('artist:"Jay Chou" rating:4 love song')).toEqual({
      tags: [
        { field: "artist", value: "Jay Chou" },
        { field: "rating", value: "4" },
      ],
      words: "love song",
    });
  });

  it("reads a field in any case, and a word naming no field as a plain word", () => {
    expect(parseQuery("Artist:Jay re:play")).toEqual({
      tags: [{ field: "artist", value: "Jay" }],
      words: "re:play",
    });
  });

  it("reads a tag still being typed: no value yet, or a quote left open", () => {
    expect(parseQuery('album: song:"Blue and').tags).toEqual([
      { field: "album", value: "" },
      { field: "song", value: "Blue and" },
    ]);
  });

  it("reads a quote left open after a word that names no field as plain words", () => {
    expect(parseQuery('say:"hi artist:Jay')).toEqual({
      tags: [{ field: "artist", value: "Jay" }],
      words: 'say:"hi',
    });
  });

  it("reads a full-width colon, as an input method types it, as a tag's", () => {
    expect(parseQuery("artist：周杰伦").tags).toEqual([{ field: "artist", value: "周杰伦" }]);
    expect(fieldTyped("artist：")).toEqual({ field: "artist", before: "" });
  });

  it("is said as a heading says it, tags by name and words quoted", () => {
    expect(querySaid('artist:"Jay Chou" album: love song')).toBe("Artist: Jay Chou, “love song”");
    expect(querySaid("album:")).toBe("");
  });

  it("is written back the way it is read", () => {
    const query = {
      tags: [
        { field: "artist", value: "Jay Chou" },
        { field: "favorite", value: "yes" },
        { field: "album", value: "" },
      ],
      words: " love ",
    } as const;

    const text = queryText(query);

    expect(text).toBe('artist:"Jay Chou" favorite:yes album:"" love');
    expect(parseQuery(text)).toEqual({ ...query, words: "love" });
  });
});

describe("a field typed in the search box", () => {
  it("is found when the text ends by naming it, with what came before", () => {
    expect(fieldTyped("artist:")).toEqual({ field: "artist", before: "" });
    expect(fieldTyped("love  Album:")).toEqual({ field: "album", before: "love" });
  });

  it("is not found inside a word, or for a name that is no field", () => {
    expect(fieldTyped("loveartist:")).toBeUndefined();
    expect(fieldTyped("re:")).toBeUndefined();
    expect(fieldTyped("artist:J")).toBeUndefined();
  });
});

describe("a site named in the box", () => {
  it("is the site a word names with a colon, the rest kept", () => {
    expect(siteTyped("melt bilibili:BV1Xx", ["bilibili"])).toEqual({
      site: "bilibili",
      rest: "melt BV1Xx",
    });
    expect(siteTyped("Bilibili：", ["bilibili"])).toEqual({ site: "bilibili", rest: "" });
  });

  it("is none for a site that can't be searched, or a field", () => {
    expect(siteTyped("bilibili:melt", [])).toBeUndefined();
    expect(siteTyped("artist:ryo", ["bilibili"])).toBeUndefined();
  });
});
