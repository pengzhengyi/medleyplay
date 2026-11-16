// cspell:ignore loveartist
import { describe, expect, it } from "vitest";

import { fieldTyped, parseQuery, queryText } from "./query";

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
