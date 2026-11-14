import { describe, expect, it } from "vitest";

import type { ArtistNames, KnownArtist } from "../api";
import { artistNameOf } from "../testing/server";
import { NO_LINKS, linksOf, withLinkedFavorites } from "./artistLinks";
import { NO_FAVORITES } from "./favoriteGroups";

const BEATLES: KnownArtist = {
  id: "b10bbbfc",
  name: "The Beatles",
  sort_name: "Beatles, The",
  disambiguation: "UK rock band",
  country: "GB",
  aliases: [
    { name: "披头士", locale: "zh", primary: true },
    { name: "甲壳虫", locale: "zh", primary: false },
  ],
};

/** 披头士 and 甲壳虫 linked to The Beatles, Blue Room linked to none, Melt not linked. */
const LINKED: ArtistNames = {
  names: [
    artistNameOf("披头士", BEATLES.id),
    artistNameOf("甲壳虫", BEATLES.id),
    artistNameOf("Blue Room", null),
    artistNameOf("Melt"),
  ],
  artists: [BEATLES],
};

describe("artist links", () => {
  it("put the names linked to one artist in one group, apart from every other name", () => {
    const links = linksOf(LINKED);

    expect(links.groupOf("披头士")).toBe(links.groupOf("甲壳虫"));
    expect(links.groupOf("Melt")).not.toBe(links.groupOf("披头士"));
    expect(links.groupOf("Blue Room")).toBe(NO_LINKS.groupOf("Blue Room"));
  });

  it("compare names folded, as the Library does", () => {
    expect(linksOf(LINKED).groupOf("ＭＥＬＴ")).toBe(linksOf(LINKED).groupOf("melt"));
  });

  it("know every name a linked artist goes by", () => {
    const links = linksOf(LINKED);

    expect(links.aliasesOf(links.groupOf("披头士"))).toEqual([
      "The Beatles",
      "Beatles, The",
      "披头士",
      "甲壳虫",
    ]);
    expect(links.aliasesOf(links.groupOf("Melt"))).toEqual([]);
  });

  it("make a favorite of one name a favorite of every name linked with it", () => {
    const favorites = { ...NO_FAVORITES, artists: new Set(["甲壳虫"]) };

    const linked = withLinkedFavorites(favorites, linksOf(LINKED));

    expect([...linked.artists].sort()).toEqual(["披头士", "甲壳虫"].sort());
  });
});
